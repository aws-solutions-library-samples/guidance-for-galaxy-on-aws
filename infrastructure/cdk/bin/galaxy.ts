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
