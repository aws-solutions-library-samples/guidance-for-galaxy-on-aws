#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import * as lambda from "aws-cdk-lib/aws-lambda";
import { InfrastructureStack } from '../lib/infrastructure-stack';
import { ApplicationStack } from '../lib/application-stack';
import { ProviderStack } from '../lib/provider-stack';

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

const providerStack = new ProviderStack(app, 'Provider', {env: { account, region }, description: "EKS Cluster Stack - Guidance for Galaxy on AWS (SO9346)"});

const galaxyInfraStack = new InfrastructureStack(app, 'GlxInfra', {
  env: { account, region },
  description: "Infrastructure DB,RDS,MQ Stack - Guidance for Galaxy on AWS (SO9346)",
  eksCluster: providerStack.eksCluster,
});

const applicationStack = new ApplicationStack(app, 'GlxApp', {
  env: { account, region },
  description: "Galaxy  Application Stack - Guidance for Galaxy on AWS (SO9346)",
  eksCluster: providerStack.eksCluster,
  databaseCluster: galaxyInfraStack.databaseCluster,
  databaseSecret: galaxyInfraStack.databaseSecret,
  rabbitmqCluster: galaxyInfraStack.rabbitmqCluster,
  rabbitmqSecret: galaxyInfraStack.rabbitmqSecret,
  fileSystem: galaxyInfraStack.fileSystem,
  databaseProxy: galaxyInfraStack.databaseProxy,
});

cdk.Aspects.of(app).add({
  visit: (node: IConstruct) => {
    if (node instanceof lambda.CfnFunction) {
      node.addPropertyOverride('Environment.Variables.AWS_STS_REGIONAL_ENDPOINTS', 'regional')
    }
  }
});