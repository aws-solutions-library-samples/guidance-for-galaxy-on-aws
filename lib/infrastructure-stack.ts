import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as amazonmq from 'aws-cdk-lib/aws-amazonmq';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaPython from '@aws-cdk/aws-lambda-python-alpha';

function isDefined(val: any) {
  return typeof val !== 'undefined';
}

export interface InfrastructureStackProps extends cdk.StackProps {
  eksCluster: eks.ICluster;
}

export class InfrastructureStack extends cdk.Stack {
  public readonly databaseCluster: rds.IDatabaseCluster;
  public readonly databaseSecret: secretsmanager.ISecret;
  public readonly databaseProxy: rds.IDatabaseProxy;
  public readonly rabbitmqCluster: amazonmq.CfnBroker;
  public readonly rabbitmqSecret: secretsmanager.ISecret;
  public readonly fileSystem: efs.IFileSystem;

  constructor(scope: Construct, id: string, props: InfrastructureStackProps) {
    super(scope, id, props);

    const characterToExclueInPassword = '<>$/"#%{}|\\^~[]`@, :;=\'.+-?'; // Galaxy helm chart does not URL encode the password as of now

    /////////////////////////////
    // # EFS
    /////////////////////////////

    const fileSystemSecurityGroup = new ec2.SecurityGroup(
      this,
      'fileSystemSecurityGroup',
      {
        vpc: props.eksCluster.vpc,
        description: 'Security Group to access EFS from Galaxy',
        allowAllOutbound: true,
      }
    );

    fileSystemSecurityGroup.addIngressRule(
      props.eksCluster.clusterSecurityGroup,
      ec2.Port.tcp(2049),
      'k8s ingress'
    );

    const myFileSystemPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: [
            'elasticfilesystem:ClientWrite',
            'elasticfilesystem:ClientMount',
            'elasticfilesystem:ClientRootAccess',
          ],
          principals: [new iam.AnyPrincipal()],
          resources: ['*'],
          conditions: {
            Bool: {
              'aws:SecureTransport': 'false',
            },
          },
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'elasticfilesystem:ClientWrite',
            'elasticfilesystem:ClientMount',
            'elasticfilesystem:ClientRootAccess',
          ],
          principals: [new iam.AnyPrincipal()],
          resources: ['*'],
          conditions: {
            Bool: {
              'aws:SecureTransport': 'true',
            },
          },
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: [
            'elasticfilesystem:ClientWrite',
            'elasticfilesystem:ClientMount',
            'elasticfilesystem:ClientRootAccess',
          ],
          principals: [new iam.AnyPrincipal()],
          resources: ['*'],
          conditions: {
            NotIpAddress: {
              'aws:SourceIp': [props.eksCluster.vpc.vpcCidrBlock],
            },
          },
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'elasticfilesystem:ClientWrite',
            'elasticfilesystem:ClientMount',
            'elasticfilesystem:ClientRootAccess',
          ],
          principals: [new iam.AnyPrincipal()],
          resources: ['*'],
          conditions: {
            IpAddress: {
              'aws:SourceIp': [props.eksCluster.vpc.vpcCidrBlock],
            },
          },
        }),
      ],
    });

    this.fileSystem = new efs.FileSystem(this, 'fileSystem', {
      vpc: props.eksCluster.vpc,
      securityGroup: fileSystemSecurityGroup,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      fileSystemPolicy: myFileSystemPolicy,
    });

    /////////////////////////////
    // # Aurora
    /////////////////////////////

    let databasePort = this.node.tryGetContext('rds.port') || 2345;
    const galaxydbuser = 'galaxydbuser';

    const databaseSecurityGroup = new ec2.SecurityGroup(
      this,
      'databaseSecurityGroup',
      {
        vpc: props.eksCluster.vpc,
      }
    );

    this.databaseSecret = new secretsmanager.Secret(this, 'databaseSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: galaxydbuser }),
        generateStringKey: 'password',
        excludeCharacters: characterToExclueInPassword,
        passwordLength: 16,
      },
    });

    let contextRdsEnableSecretRotation = this.node.tryGetContext(
      'rds.enableSecretRotation'
    );

    const rdsEnableSecretRotation = isDefined(contextRdsEnableSecretRotation)
      ? contextRdsEnableSecretRotation
      : true;

    const lambdaDBSecretRotationSecurityGroup = new ec2.SecurityGroup(
      this,
      'lambdaGalaxyDBSecretRotationSecurityGroup',
      {
        vpc: props.eksCluster.vpc,
      }
    );

    // Deploy the security group only when key rotation is enabled
    (
      lambdaDBSecretRotationSecurityGroup.node
        .defaultChild as cdk.aws_ec2.CfnSecurityGroup
    ).cfnOptions.condition = rdsEnableSecretRotation;

    if (rdsEnableSecretRotation) {
      this.databaseSecret.addRotationSchedule('rotateDBkey', {
        hostedRotation: secretsmanager.HostedRotation.postgreSqlSingleUser({
          vpc: props.eksCluster.vpc,
          excludeCharacters: characterToExclueInPassword,
          securityGroups: [
            lambdaDBSecretRotationSecurityGroup ||
              new ec2.SecurityGroup(this, 'cdkworkaroundsg', {
                vpc: props.eksCluster.vpc,
              }),
          ],
        }),
        automaticallyAfter: cdk.Duration.days(
          this.node.tryGetContext('galaxy.keyRotationInterval') || 365
        ),
      });
    }

    this.databaseCluster = new rds.DatabaseCluster(this, 'databaseCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_13_10,
      }),
      vpc: props.eksCluster.vpc,
      credentials: rds.Credentials.fromSecret(this.databaseSecret),
      writer: rds.ClusterInstance.serverlessV2('auroraServerlessWriter'),
      readers: undefined,
      serverlessV2MinCapacity: this.node.tryGetContext('rds.minCapacity'),
      serverlessV2MaxCapacity: this.node.tryGetContext('rds.maxCapacity'),
      port: databasePort,
      defaultDatabaseName: 'galaxy',
      securityGroups: [databaseSecurityGroup],
      storageEncrypted: true,
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      backup: {
        retention: cdk.Duration.days(
          this.node.tryGetContext('rds.snapshotRetentionInDays')
        ),
      },
    });

    const isRdsProxy = this.node.tryGetContext('rds.proxy');

    if (isRdsProxy) {
      const databaseProxySecurityGroup = new ec2.SecurityGroup(
        this,
        'databaseProxySecurityGroup',
        {
          vpc: props.eksCluster.vpc,
        }
      );
      databaseSecurityGroup.addIngressRule(
        databaseProxySecurityGroup,
        ec2.Port.tcp(databasePort),
        'proxy ingress'
      );
      databaseProxySecurityGroup.addIngressRule(
        props.eksCluster.clusterSecurityGroup,
        ec2.Port.tcp(5432),
        'k8s ingress'
      );
      if (rdsEnableSecretRotation) {
        databaseProxySecurityGroup.addIngressRule(
          lambdaDBSecretRotationSecurityGroup,
          ec2.Port.tcp(5432),
          'lambda key rotation ingress'
        );
      }
      this.databaseProxy = new rds.DatabaseProxy(this, 'databaseProxy', {
        proxyTarget: rds.ProxyTarget.fromCluster(this.databaseCluster),
        secrets: [this.databaseSecret],
        vpc: props.eksCluster.vpc,
        securityGroups: [databaseProxySecurityGroup],
      });
    } else {
      databaseSecurityGroup.addIngressRule(
        props.eksCluster.clusterSecurityGroup,
        ec2.Port.tcp(databasePort),
        'k8s ingress'
      );
      if (rdsEnableSecretRotation) {
        databaseSecurityGroup.addIngressRule(
          lambdaDBSecretRotationSecurityGroup,
          ec2.Port.tcp(databasePort),
          'lambda key rotation ingress'
        );
      }
    }

    /////////////////////////////
    // # RABBITMQ
    /////////////////////////////

    this.rabbitmqSecret = new secretsmanager.Secret(this, 'rabbitmqSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'administrator' }),
        generateStringKey: 'password',
        excludeCharacters: characterToExclueInPassword,
        passwordLength: 16,
      },
    });

    const rabbitMQAsCluster: boolean =
      this.node.tryGetContext('rabbitmq.cluster');
    const rabbitMQInstanceSize:
      | 'mq.t3.micro'
      | 'mq.m5.large'
      | 'mq.m5.xlarge'
      | 'mq.m5.2xlarge'
      | 'mq.m5.4xlarge' = this.node.tryGetContext('rabbitmq.instance');

    const rabbitmqSecurityGroup = new ec2.SecurityGroup(
      this,
      'rabbitmqSecurityGroup',
      {
        vpc: props.eksCluster.vpc,
        description: 'Security Group to access RabbitMQ from Galaxy',
        allowAllOutbound: true,
      }
    );
    rabbitmqSecurityGroup.addIngressRule(
      props.eksCluster.clusterSecurityGroup,
      ec2.Port.tcp(5671),
      'k8s ingress'
    );

    this.rabbitmqCluster = new amazonmq.CfnBroker(this, 'rabbitmqCluster', {
      autoMinorVersionUpgrade: true,
      brokerName: 'rabbitmq' + cdk.Aws.STACK_NAME,
      deploymentMode: rabbitMQAsCluster
        ? 'CLUSTER_MULTI_AZ'
        : 'SINGLE_INSTANCE',
      engineType: 'RABBITMQ',
      engineVersion: '3.11.16',
      hostInstanceType: rabbitMQInstanceSize,
      publiclyAccessible: false,
      users: [
        {
          username: this.rabbitmqSecret
            .secretValueFromJson('username')
            .unsafeUnwrap()
            .toString(),
          password: this.rabbitmqSecret
            .secretValueFromJson('password')
            .unsafeUnwrap()
            .toString(),
        },
      ],
      securityGroups: [rabbitmqSecurityGroup.securityGroupId],
      subnetIds: rabbitMQAsCluster
        ? props.eksCluster.vpc.privateSubnets.map((subnet) => subnet.subnetId)
        : [props.eksCluster.vpc.privateSubnets[0].subnetId],
    });

    const rabbitMqUrl = cdk.Fn.select(
      1,
      cdk.Fn.split(
        '//',
        cdk.Fn.select(
          1,
          cdk.Fn.split(
            ':',
            cdk.Fn.select(0, this.rabbitmqCluster.attrAmqpEndpoints)
          )
        )
      )
    );

    new cdk.CfnOutput(this, 'rabbitmqEndpoint', {
      exportName: 'rabbitmqEndpoint',
      value: rabbitMqUrl,
    });

    /////////////////////////////
    // # RABBITMQ SECRET ROTATION
    /////////////////////////////
    let contextMqEnableSecretRotation = this.node.tryGetContext(
      'mq.enableSecretRotation'
    );
    const mqEnableSecretRotation = isDefined(contextMqEnableSecretRotation)
      ? contextMqEnableSecretRotation
      : true;
    if (mqEnableSecretRotation) {
      const lambdaMqSecretRotatingRole = new iam.Role(
        this,
        'lambdaMqSecretRotatingRole',
        {
          assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        }
      );

      const lambdaMqSecurityGroup = new ec2.SecurityGroup(
        this,
        'lambdaMqSecurityGroup',
        {
          vpc: props.eksCluster.vpc,
          allowAllOutbound: true,
        }
      );

      const contextLambdaArchitecture = this.node.tryGetContext(
        'lambda.arm64keyRotationArchitecture'
      );
      const lambdaArchitecture = 
        isDefined(contextLambdaArchitecture) &&
        contextLambdaArchitecture == 'true'
          ? lambda.Architecture.ARM_64
          : lambda.Architecture.X86_64;

      const lambdaMqSecretRotatingLayer = new lambdaPython.PythonLayerVersion(
        this,
        'lambdaMqSecretRotatingLayer',
        {
          entry: 'resources/lambda_mq_secret_rotating_layer',
          compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
          compatibleArchitectures: [lambdaArchitecture],
          layerVersionName: 'lambdaMqSecretRotatingLayer',
        }
      );
      const lambdaMqSecretRotating = new lambdaPython.PythonFunction(
        this,
        'lambdaMqSecretRotating',
        {
          runtime: lambda.Runtime.PYTHON_3_11,
          entry: 'resources/lambda_mq_secret_rotating',
          memorySize: 128,
          timeout: cdk.Duration.minutes(1),
          role: lambdaMqSecretRotatingRole,
          environment: {
            HOST: `https://${rabbitMqUrl}:443`,
            EXCLUDE_CHARACTERS: characterToExclueInPassword,
          },
          layers: [lambdaMqSecretRotatingLayer],
          vpc: props.eksCluster.vpc,
          architecture: lambdaArchitecture,
          securityGroups: [lambdaMqSecurityGroup],
        }
      );

      this.rabbitmqSecret.addRotationSchedule('rotateMQkey', {
        rotationLambda: lambdaMqSecretRotating,
        automaticallyAfter: cdk.Duration.days(
          this.node.tryGetContext('galaxy.keyRotationInterval') || 365
        ),
      });

      rabbitmqSecurityGroup.addIngressRule(
        lambdaMqSecurityGroup,
        ec2.Port.tcp(443),
        'lambda key rotation ingress'
      );

      lambdaMqSecretRotatingRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          resources: [this.rabbitmqSecret.secretArn],
          actions: [
            'secretsmanager:GetSecretValue',
            'secretsmanager:DescribeSecret',
            'secretsmanager:PutSecretValue',
            'secretsmanager:UpdateSecretVersionStage',
          ],
        })
      );

      // These are the minimum permissions for lambda to access VPC resources
      // https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSLambdaVPCAccessExecutionRole.html
      // > AWSLambdaVPCAccessExecutionRole is an AWS managed policy that: Provides minimum permissions for a Lambda function to execute while accessing a resource within a VPC
      lambdaMqSecretRotatingRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          resources: ['*'],
          actions: [
            'ec2:CreateNetworkInterface',
            'ec2:DescribeNetworkInterfaces',
            'ec2:DeleteNetworkInterface',
            'ec2:AssignPrivateIpAddresses',
            'ec2:UnassignPrivateIpAddresses',
          ],
        })
      );
      // Policy is minimal
      // https://docs.aws.amazon.com/service-authorization/latest/reference/list_awssecretsmanager.html
      // > Quote
      lambdaMqSecretRotatingRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          resources: [this.rabbitmqSecret.secretArn],
          actions: ['secretsmanager:GetRandomPassword'],
        })
      );

      lambdaMqSecretRotating.addPermission(
        'secretsManagerExecutionPermission',
        {
          action: 'lambda:InvokeFunction',
          principal: new iam.ServicePrincipal('secretsmanager.amazonaws.com'),
          sourceAccount: this.account,
        }
      );

      // Logs need * permissions: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/iam-identity-based-access-control-cwl.html#customer-managed-policies-cwl
      // Quote:
      // > The :* at the end of the log group name in the Resource line is required to indicate that the policy applies to all log streams in this log group. If you omit :*, the policy will not be enforced.
      lambdaMqSecretRotatingRole.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:DescribeLogStreams',
            'logs:PutLogEvents',
            'logs:PutRetentionPolicy',
          ],
          resources: [
            cdk.Stack.of(this).formatArn({
              service: 'logs',
              resource: 'log-group',
              resourceName: `/aws/lambda/${lambdaMqSecretRotating.node.path.replace(
                '/',
                '-'
              )}*:*`,
              arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
            }),
          ],
        })
      );
    }

    /////////////////////////////
    // # BACKUPS
    /////////////////////////////

    const backupsEnabled: boolean = this.node.tryGetContext(
      'galaxy.backupsEnabled'
    );

    if (backupsEnabled) {
      const vault = new backup.BackupVault(this, 'BackupVault', {});
      const vaultUid: string = cdk.Names.uniqueId(this);

      const policyDocument = new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [
              `arn:aws:rds:${this.region}:${this.account}:cluster:${this.databaseCluster.clusterIdentifier}`,
            ],
            actions: [
              'rds:CreateDBClusterSnapshot',
              'rds:DescribeDBClusters',
              'rds:DescribeDBClusterSnapshots',
              'rds:AddTagsToResource',
              'rds:ListTagsForResource',
              'rds:CopyDBClusterSnapshot',
            ],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [this.fileSystem.fileSystemArn],
            actions: [
              'elasticfilesystem:Backup',
              'elasticfilesystem:DescribeTags',
            ],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [vault.backupVaultArn],
            actions: [
              'backup:DescribeBackupVault',
              'backup:CopyIntoBackupVault',
            ],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [
              `arn:aws:rds:${this.region}:${this.account}:cluster:${this.databaseCluster.clusterIdentifier}`,
              this.fileSystem.fileSystemArn,
              vault.backupVaultArn,
            ],
            actions: ['tag:GetResources'],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [
              `arn:aws:rds:${this.region}:${this.account}:cluster-snapshot:awsbackup:job*`,
            ],
            actions: ['rds:DeleteDBClusterSnapshot'],
            conditions: {
              StringEquals: {
                'aws:cloudformation:stack-name': vaultUid,
              },
            },
          }),
        ],
      });

      const role: iam.Role = new iam.Role(this, 'backupvault', {
        assumedBy: new iam.ServicePrincipal('backup.amazonaws.com'),
        description:
          'Role used by AWS Backup to create backups for Galaxy for data stored in Amazon Aurora and Amazon EFS',
        inlinePolicies: {
          galaxybackuppolicy: policyDocument,
        },
        managedPolicies: [],
      });

      const plan = backup.BackupPlan.dailyMonthly1YearRetention(
        this,
        'GalaxyBackups',
        vault
      );

      plan.addSelection('GalaxyInfraSelection', {
        resources: [
          backup.BackupResource.fromEfsFileSystem(this.fileSystem),
          backup.BackupResource.fromRdsDatabaseCluster(this.databaseCluster),
        ],
        role: role,
      });
    }
  }
}
