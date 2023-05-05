import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as amazonmq from 'aws-cdk-lib/aws-amazonmq';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface InfrastructureStackProps extends cdk.StackProps {
  eksCluster: eks.ICluster;
}

export class InfrastructureStack extends cdk.Stack {
  public readonly databaseCluster: rds.ServerlessCluster;
  public readonly rabbitmqCluster: amazonmq.CfnBroker;
  public readonly rabbitmqSecret: secretsmanager.ISecret;
  public readonly fileSystem: efs.IFileSystem;

  constructor(scope: Construct, id: string, props: InfrastructureStackProps) {
    super(scope, id, props);

    /////////////////////////////
    // # EFS
    /////////////////////////////

    const fileSystemSecurityGroup = new ec2.SecurityGroup(this, 'fileSystemSecurityGroup', {
      vpc: props.eksCluster.vpc,
    });

    fileSystemSecurityGroup.addIngressRule(props.eksCluster.clusterSecurityGroup, ec2.Port.tcp(2049), 'k8s ingress');

    this.fileSystem = new efs.FileSystem(this, 'fileSystem', {
      vpc: props.eksCluster.vpc,
      securityGroup: fileSystemSecurityGroup,
    });

    /////////////////////////////
    // # RDS
    /////////////////////////////

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'databaseSecurityGroup', {
      vpc: props.eksCluster.vpc,
    });

    databaseSecurityGroup.addIngressRule(props.eksCluster.clusterSecurityGroup, ec2.Port.tcp(5432), 'k8s ingress');

    this.databaseCluster = new rds.ServerlessCluster(this, 'databaseCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_14_6,
      }),
      vpc: props.eksCluster.vpc,
      credentials: {
        username: 'galaxydbuser',
      },
      defaultDatabaseName: 'galaxy',
      securityGroups: [databaseSecurityGroup],
      backupRetention: cdk.Duration.days(this.node.tryGetContext('rds.backupRetentionInDays')),
    });

    /////////////////////////////
    // # RABBITMQ
    /////////////////////////////

    this.rabbitmqSecret = new secretsmanager.Secret(this, 'rabbitmqSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'administrator' }),
        generateStringKey: 'password',
        excludeCharacters: "<>/\"#%{}|\\^~[]`@, :;='.+", // Galaxy helm chart does not URL encode the password as of now
        passwordLength: 16,
      },
    });

    const rabbitmqSecurityGroup = new ec2.SecurityGroup(this, 'rabbitmqSecurityGroup', {
      vpc: props.eksCluster.vpc,
    });

    rabbitmqSecurityGroup.addIngressRule(props.eksCluster.clusterSecurityGroup, ec2.Port.tcp(5671), 'k8s ingress');

    const rabbitMQAsCluster: boolean = this.node.tryGetContext('rabbitmq.cluster');
    const rabbitMQInstanceSize: "mq.t3.micro" | "mq.m5.large" | "mq.m5.xlarge" | "mq.m5.2xlarge" | "mq.m5.4xlarge" = this.node.tryGetContext('rabbitmq.instance');

    this.rabbitmqCluster = new amazonmq.CfnBroker(this, 'rabbitmqCluster', {
      autoMinorVersionUpgrade: true,
      brokerName: 'rabbitmq' + cdk.Aws.STACK_NAME,
      deploymentMode: rabbitMQAsCluster ? 'CLUSTER_MULTI_AZ' : 'SINGLE_INSTANCE',
      engineType: 'RABBITMQ',
      engineVersion: '3.10.10',
      hostInstanceType: rabbitMQInstanceSize,
      publiclyAccessible: false,
      users: [{
        username: this.rabbitmqSecret.secretValueFromJson('username').unsafeUnwrap().toString(),
        password: this.rabbitmqSecret.secretValueFromJson('password').unsafeUnwrap().toString(),
      }],
      securityGroups: [rabbitmqSecurityGroup.securityGroupId],
      subnetIds: rabbitMQAsCluster ? props.eksCluster.vpc.privateSubnets.map(subnet => subnet.subnetId) : [props.eksCluster.vpc.privateSubnets[0].subnetId],
    });

    new cdk.CfnOutput(this, 'rabbitmqEndpoint', {
      exportName: 'rabbitmqEndpoint',
      value: cdk.Fn.select(1, cdk.Fn.split('//', cdk.Fn.select(1, cdk.Fn.split(':', cdk.Fn.select(0, this.rabbitmqCluster.attrAmqpEndpoints))))),
    });
  }
}

