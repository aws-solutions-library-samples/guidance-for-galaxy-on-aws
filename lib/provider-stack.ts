import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as blueprints from '@aws-quickstart/eks-blueprints';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

export class ProviderStack extends cdk.Stack {
  public readonly eksCluster: eks.ICluster;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const existingEksName = this.node.tryGetContext('eks.clusterName');
    const existingVpcId = this.node.tryGetContext('vpc.id');

    if (existingEksName) {
      const existingSecurityGroupId = this.node.tryGetContext(
        'eks.securityGroupId'
      );
      const kubectlRoleArn = this.node.tryGetContext('eks.kubectlRoleArn');

      if (!existingVpcId)
        throw new Error(
          'You must provide vpc.id context when reusing existing EKS cluster.'
        );
      if (!existingSecurityGroupId)
        throw new Error(
          'You must provide eks.securityGroupId context when reusing existing EKS cluster.'
        );
      if (!kubectlRoleArn)
        throw new Error(
          'You must provide eks.kubectlRoleArn context when reusing existing EKS cluster.'
        );

      this.eksCluster = eks.Cluster.fromClusterAttributes(this, 'eksCluster', {
        clusterName: existingEksName,
        kubectlRoleArn: kubectlRoleArn,
        clusterSecurityGroupId: existingSecurityGroupId,
        vpc: ec2.Vpc.fromLookup(this, 'Vpc', {
          vpcId: existingVpcId,
        }),
      });
    } else {
      const addOns: Array<blueprints.ClusterAddOn> = [
        new blueprints.addons.AwsLoadBalancerControllerAddOn(),
        new blueprints.addons.MetricsServerAddOn(),
        new blueprints.addons.EfsCsiDriverAddOn(),
        new blueprints.addons.ClusterAutoScalerAddOn(),
        new blueprints.addons.VpcCniAddOn({
          enableNetworkPolicy: true,
        }),
        new blueprints.addons.CoreDnsAddOn(),
        new blueprints.addons.KubeProxyAddOn(),
        new blueprints.addons.ExternalsSecretsAddOn({}),
        new blueprints.addons.AwsForFluentBitAddOn({
          // Logs need * permissions: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/iam-identity-based-access-control-cwl.html#customer-managed-policies-cwl
          // Quote:
          // > The :* at the end of the log group name in the Resource line is required to indicate that the policy applies to all log streams in this log group. If you omit :*, the policy will not be enforced.
          iamPolicies: [
            new iam.PolicyStatement({
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:DescribeLogStreams',
                'logs:PutLogEvents',
                'logs:PutRetentionPolicy',
              ],
              resources: [
                'logs',
                'workload/default',
                'workload/external-secrets',
                'workload/galaxy',
                'workload/kube-system',
              ].map((logname) =>
                cdk.Stack.of(this).formatArn({
                  service: 'logs',
                  resource: 'log-group',
                  resourceName: `/aws/eks/fluentbit-cloudwatch/${logname}:*`,
                  arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
                })
              ),
            }),
          ],
          values: {
            cloudWatchLogs: {
              region: cdk.Stack.of(this).region,
              enabled: true,
              logRetentionDays:
                this.node.tryGetContext('cloudwatch.logRetentionDays') || 30,
            },
          },
        }),
      ];

      const controlPlaneLogs = [
        blueprints.ControlPlaneLogType.API,
        blueprints.ControlPlaneLogType.AUDIT,
        blueprints.ControlPlaneLogType.AUTHENTICATOR,
        blueprints.ControlPlaneLogType.CONTROLLER_MANAGER,
        blueprints.ControlPlaneLogType.SCHEDULER,
      ];

      const eksClusterBuilder = blueprints.EksBlueprint.builder()
        .account(cdk.Stack.of(this).account)
        .region(cdk.Stack.of(this).region)
        .addOns(...addOns)
        .enableControlPlaneLogTypes(...controlPlaneLogs)
        .version(eks.KubernetesVersion.V1_27);
      if (existingVpcId) {
        eksClusterBuilder.resourceProvider(
          blueprints.GlobalResources.Vpc,
          new blueprints.VpcProvider(existingVpcId)
        );
      }

      const eksClusterStack = eksClusterBuilder.build(this, 'EKS');
      eksClusterStack.addMetadata('description', 'EKS Cluster Stack - Guidance for Galaxy on AWS (SO9346)')

      this.eksCluster = eksClusterStack.getClusterInfo().cluster;

      const vpc = this.eksCluster.vpc;

      if (!existingVpcId) {
        if (this.node.tryGetContext('vpc.enableFlowlogs')) {
          vpc.addFlowLog('eks-vpc-flowlog');
        }
        // Add EKS VPC endpoint for secure communication
        vpc.addInterfaceEndpoint('eks-vpc-endpoint', {
          service: ec2.InterfaceVpcEndpointAwsService.EKS,
          subnets: {
            onePerAz: true,
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          },
          open: true,
        });
        // Add Secrets Manager VPC endpoint for secure communication
        vpc.addInterfaceEndpoint('secretsmanager-vpc-endpoint', {
          service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
          subnets: {
            onePerAz: true,
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          },
          open: true,
        });
      }
    }
  }
}
