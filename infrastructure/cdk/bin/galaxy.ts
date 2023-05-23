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

app.node.setContext("galaxy.adminEmails", 'yegor@amazon.com,mapk@amazon.de,mibosch@amazon.de');

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

cdk.Aspects.of(app).add({
  visit: (node: IConstruct) => {
    if (node instanceof lambda.CfnFunction) {
      node.addPropertyOverride('Environment.Variables.AWS_STS_REGIONAL_ENDPOINTS', 'regional')
    }
  }
});