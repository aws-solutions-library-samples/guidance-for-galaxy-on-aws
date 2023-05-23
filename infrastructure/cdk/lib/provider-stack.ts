import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as blueprints from '@aws-quickstart/eks-blueprints';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from 'aws-cdk-lib/aws-iam';

export class ProviderStack extends cdk.Stack {
  public readonly eksCluster: eks.ICluster;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const existingEksName = this.node.tryGetContext('eks.clusterName');
    const existingVpcId = this.node.tryGetContext('vpc.id');

    if (existingEksName) {
      const existingSecurityGroupId = this.node.tryGetContext('eks.securityGroupId');
      const kubectlRoleArn = this.node.tryGetContext('eks.kubectlRoleArn');

      if (!existingVpcId) throw new Error('You must provide vpc.id context when reusing existing EKS cluster.');
      if (!existingSecurityGroupId) throw new Error('You must provide eks.securityGroupId context when reusing existing EKS cluster.');
      if (!kubectlRoleArn) throw new Error('You must provide eks.kubectlRoleArn context when reusing existing EKS cluster.');

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
        new blueprints.addons.VpcCniAddOn(),
        new blueprints.addons.CoreDnsAddOn(),
        new blueprints.addons.KubeProxyAddOn(),
        new blueprints.addons.ExternalsSecretsAddOn({}),
        new blueprints.addons.AwsForFluentBitAddOn({
          iamPolicies: [
            new iam.PolicyStatement({
              actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:DescribeLogStreams', 'logs:PutLogEvents'],
              resources: ['arn:aws:logs:*:*:*']
            })
          ],
          values: {
            cloudWatch: {
              region: cdk.Stack.of(this).region,
              enabled: true
            }
          }
        })
      ];

      const eksClusterBuilder = blueprints.EksBlueprint.builder()
        .account(cdk.Stack.of(this).account)
        .region(cdk.Stack.of(this).region)
        .addOns(...addOns);

      if (existingVpcId) {
        eksClusterBuilder.resourceProvider(blueprints.GlobalResources.Vpc, new blueprints.VpcProvider(existingVpcId));
      }

      const eksClusterStack = eksClusterBuilder.build(this, 'EKS');

      this.eksCluster = eksClusterStack.getClusterInfo().cluster
}
