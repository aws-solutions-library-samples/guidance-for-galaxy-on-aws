#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack } from '../lib/infrastructure-stack';
import { ApplicationStack } from '../lib/application-stack';
import { ProviderStack } from '../lib/provider-stack';
import * as ec2 from "aws-cdk-lib/aws-ec2";

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

app.node.setContext("galaxy.adminEmails", 'yegor@amazon.com');

// app.node.setContext("vpc.id", 'vpc-0b79783c69ed3f8fd');
// app.node.setContext("eks.clusterName", 'eksClusterStack');
// app.node.setContext("eks.securityGroupId", 'sg-0c39547363063bcab');
// app.node.setContext("eks.kubectlRoleArn", 'arn:aws:iam::761128311188:role/eksClusterStack-eksClusterStackCreationRole2E80C23-1VRM7BE1MQ2RZ');

// needs to stay here until PR is merged:
// https://github.com/aws-quickstart/cdk-eks-blueprints/pull/654
app.node.setContext("eks.default.instance-type", ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.XLARGE4));

const providerStack = new ProviderStack(app, 'Provider', {env: { account, region }});

const galaxyInfraStack = new InfrastructureStack(app, 'GlxInfra', {
  env: { account, region },
  eksCluster: providerStack.eksCluster,
});

const applicationStack = new ApplicationStack(app, 'GlxApp', {
  env: { account, region },
  eksCluster: providerStack.eksCluster,
  databaseCluster: galaxyInfraStack.databaseCluster,
  rabbitmqCluster: galaxyInfraStack.rabbitmqCluster,
  rabbitmqSecret: galaxyInfraStack.rabbitmqSecret,
  fileSystem: galaxyInfraStack.fileSystem,
});
