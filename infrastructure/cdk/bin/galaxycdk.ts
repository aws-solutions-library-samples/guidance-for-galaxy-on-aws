#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as blueprints from '@aws-quickstart/eks-blueprints';
import { GalaxyInfraStack } from '../lib/galaxyInfra-stack';
import { GalaxyAppStack } from '../lib/galaxyApp-stack';
import * as ec2 from "aws-cdk-lib/aws-ec2";

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = 'us-west-1'; //process.env.CDK_DEFAULT_REGION;

const addOns: Array<blueprints.ClusterAddOn> = [
  new blueprints.addons.AwsLoadBalancerControllerAddOn(),
  new blueprints.addons.MetricsServerAddOn(),
  new blueprints.addons.EbsCsiDriverAddOn(),
  new blueprints.addons.EfsCsiDriverAddOn(),
  new blueprints.addons.ClusterAutoScalerAddOn(),
  new blueprints.addons.VpcCniAddOn(),
  new blueprints.addons.CoreDnsAddOn(),
  new blueprints.addons.KubeProxyAddOn(),
  new blueprints.addons.ExternalsSecretsAddOn({}),
];

app.node.setContext("eks.default.min-size", 1);
app.node.setContext("eks.default.max-size", 5);
app.node.setContext("eks.default.desired-size", 3);
app.node.setContext("eks.default.instance-type", ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.XLARGE4));

const eksClusterStack = blueprints.EksBlueprint.builder()
  .account(account)
  .region(region)
  .addOns(...addOns)
  .useDefaultSecretEncryption(true) // set to false to turn secret encryption off (non-production/demo cases)
  .build(app, 'eksClusterStack');

const galaxyInfraStack = new GalaxyInfraStack(app, 'GalaxyInfraStack', {
  env: { account, region },
  eksCluster: eksClusterStack.getClusterInfo().cluster,
  rabbitMQAsCluster: false,
  rabbitMQInstanceSize: 'mq.t3.micro',
});

const galaxyAppStack = new GalaxyAppStack(app, 'GalaxyAppStack', {
  env: { account, region },
  eksCluster: eksClusterStack.getClusterInfo().cluster,
  databaseCluster: galaxyInfraStack.databaseCluster,
  rabbitmqCluster: galaxyInfraStack.rabbitmqCluster,
  rabbitmqSecret: galaxyInfraStack.rabbitmqSecret,
  fileSystem: galaxyInfraStack.fileSystem,
  namespace: "galaxy3",
  galaxyAdminEmails: "yegor@tokmakov.biz",
});
