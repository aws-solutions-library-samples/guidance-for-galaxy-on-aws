# Guidance for Galaxy on AWS

1. [Overview](#overview)
    - [Cost](#cost)
2. [Prerequisites](#prerequisites)
    - [Operating System](#operating-system)
    - [Third party tools](#third-party-tools)
    - [Bootstrap AWS CDK](#bootstrap-aws-cdk)
    - [Supported Regions](#supported-regions)
3. [Deployment Steps](#deployment-steps)
4. [Deployment Validation](#deployment-validation)
5. [Running the Guidance](#running-the-guidance)
   - [Production deployment and GitOps](#production-deployment-and-gitops)
6. [Next Steps](#next-steps)
   - [Infrastrcture configuration](#infrastructure-configuration)
   - [Application configuration](#application-configuration)
7. [Cleanup](#cleanup)
8. [Notices](#notices)

## Overview

This guidance helps customers run [Galaxy](https://galaxyproject.org/) on AWS and leverage security, reliability and availability of compute resources in the cloud. Galaxy is a data analysis platform focusing on accessibility, reproducibility, and transparency of primarily bioinformatics data.

![Architecture diagram of the guidance for Galaxy on AWS](/assets/architecture.png)

**Key solution components:**

- [Amazon Elastic Kubernetes Service (EKS)](https://aws.amazon.com/eks/) is a managed service that makes it easy for you to run Kubernetes on AWS without installing and operating your own Kubernetes control plane or worker nodes. This solution is based on EKS Blueprints, a framework to create fully bootstrapped EKS clusters based on [AWS CDK](https://aws.amazon.com/cdk/). Amazon EC2 [Elastic Load Balancing](https://aws.amazon.com/elasticloadbalancing/) (ELB) automatically distributes incoming application traffic across EC2 nodes in EKS Cluster in one or more Availability Zones (AZs).
- [Amazon Elastic File System (EFS)](https://aws.amazon.com/efs/) is a simple, serverless, set-and-forget elastic file system that lets you share file data without provisioning or managing storage. It's built to scale to petabytes on demand without disrupting applications. We use EFS for Galaxy tools storage and user datasets.
- [Amazon Aurora](https://aws.amazon.com/rds/aurora/) is designed for unparalleled high performance and availability at global scale with full MySQL and PostgreSQL compatibility. Amazon Aurora Serverless is used as a Galaxy database and provides built-in security, continuous backups, serverless compute.
- [Amazon MQ](https://aws.amazon.com/amazon-mq/) is a managed mess ge broker service for [Apache ActiveMQ](http://activemq.apache.org/components/classic/) and [RabbitMQ](https://www.rabbitmq.com/) that makes it easy to set up and operate message brokers in the cloud. Galaxy uses Amazon MQ and RabbitMQ broker to schedule and monitor execution jobs.
- [Amazon Simple Storage Service (S3)](https://aws.amazon.com/s3/) is object storage built to store and retrieve any amount of data from anywhere. S3 is a simple storage service that offers industry leading durability, availability, performance, security, and virtually unlimited scalability at very low costs. Galaxy uses Amazon S3 to store reference data.

### Cost

You are responsible for the cost of the AWS services used while running this Guidance. As of November 2023, the cost for running this Guidance with the default settings in the N. Virginia (us-east-1) is approximately $2200 per month. The main cost drivers are the the initially provisioned three `m5.4xlarge` instances for about $1700 per month, providing 48 vCPUs and 192 GiB Memory in total. Both the number of instances and the type can be modified, as described in [Next Steps](#infrastructure-configuration).


## Prerequisites

### Operating System
This guidance can be deployed with Windows, Mac and Linux, both with x86_64 and ARM64 architecture.

- [Create an AWS account](https://portal.aws.amazon.com/gp/aws/developer/registration/index.html) if you do not already have one and log in. The IAM user that you use must have sufficient permissions to make necessary AWS service calls and manage AWS resources.
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) installed and configured
- [AWS Cloud Development Kit v2](https://docs.aws.amazon.com/cdk/v2/guide/cli.html) >= 2.104.0 installed

### Third-party tools
- [Git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git) installed
- [Node and NPM](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) >= 14 installed

### Bootstrap AWS CDK 

This Guidance uses aws-cdk. If you are using aws-cdk for first time, please perform the bootstrapping for all accounts and regions you will deploy this guidance: [CDK Bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)

### Supported Regions
This Guidance uses various AWS Services, cf. [Overview](#overview), and those need to be available in your region. You can check here whether these services are available in the region: [Supported Services](https://aws.amazon.com/about-aws/global-infrastructure/regional-product-services/).

## Deployment Steps

1. Clone the repository using the command ```git clone https://github.com/aws-solutions-library-samples/guidance-for-galaxy-on-aws```
2. Change Directory to the cloned repository using ```cd guidance-for-galaxy-on-aws```
3. Install packages in requirements using command ```npm install```
4. [Optionally] Edit the content of ```cdk.json``` to modify parameter to fit your use case, cf. [Next Steps](#next-steps)
5. Run this command to deploy the guidance ```cdk deploy --all```. `cdk` might prompt you about changes in your account. The changes need to be accepted for the deployment to work.
6. Capture the DNS name of the load balancer ```aws cloudformation describe-stacks --stack-name "GlxApp" --query "Stacks[0].Outputs[0].OutputValue" --output text```

By default, this CDK application creates a new VPC optimized for Amazon Elastic Kubernetes (EKS), a new EKS cluster using [EKS Blueprints](https://github.com/aws-quickstart/cdk-eks-blueprints), the Galaxy-specific AWS infrastructure and Galaxy application itself. It is also possible to use an existing VPC and EKS cluster in your account. To re-use an existing VPC, you will need to provide a VPC Id to CDK context under `vpc.id` key. To re-use an existing EKS cluster, you will need to provide a EKS cluster name, Security Group Id and IAM Role ARN for Kubectl tool in CDK context under `eks.clusterName`, `eks.securityGroupId` and `eks.kubectlRoleArn` keys. Refer to Configuration section for more details.

## Deployment Validation

Entering the captured DNS address in a web browser will open your Galaxy web server. By default the load balancer listens for HTTP on port 80.
If an SSL certificate is provided, the load balancer will listen for HTTPS on port 443.

## Running the Guidance

The deployment creates a role with a name of the form _ProviderEKSXXXXXXXX-EKSAccessRoleXXXXXXXX-XXXXXXXXXXXXX_.
Only this role has access to the created EKS cluster and by default everyone in this account can assume the role to interact with the EKS cluster.
Additionally, the CloudFormation Stack _ProviderEKSXXXXXXXX_ provides two commands, _EKSConfigCommandXXXXXXXX_ and _EKSConfigCommandXXXXXXXX_, which provide `kubectl` configuration and access to interact with the cluster.
The outputs of this stack can be viewed, for example, via the AWS Management console and navigating to CloudFormation and the relevant stack.


### Production deployment and GitOps

In case your team operates an existing cluster with multiple applications or if your organization has a dedicated team who is going to centrally operate a Kubernetes cluster, it might be beneficial to set up separate CI/CD pipelines for EKS infrastructure and the Galaxy application. Please follow the application deployment instructions for [EKS Blueprints using ArgoCD](https://aws-quickstart.github.io/cdk-eks-blueprints/getting-started/#deploy-workloads-with-argocd) and the [Production Environment](https://docs.galaxyproject.org/en/latest/admin/production.html) section of the Galaxy documentation.

### Next Steps

#### Infrastructure configuration

This solution uses CDK Runtime context for the configuration of both Galaxy infrastructure dependencies and EKS Blueprint. Context values can be supplied to the CDK app from a `cdk.json` file, through the `--context` option to the `cdk` command, or in CDK app code. For example, to set the ID of an existing VPC, you can specify the context value in `bin/galaxy.ts` :

```js
app.node.setContext("vpc.id", "vpc-0a1234567890");
```

##### List of available configuration settings:

| Setting                        | Required                         | Example                                     | Description                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vpc.id                         | No                               | vpc-0a1234567890                            | Optional value that tells CDK to re-use existing VPC. The VPC must have at least two private subnets with internet access. Default subnet allocation is used. Additional requirements are listed here: https://docs.aws.amazon.com/eks/latest/userguide/network_reqs.html                                                                                                        |
| vpc.enableFlowlogs             | No                               | false                                       | If no vpc.id is provided and a new VPC created, this toggle enables/disables [VPC Flow logs](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html) for the newly created VPC. No changes to existing VPC are performed.                                                                                                                                               |
| eks.clusterName                | No                               | eksClusterName                              | Optional value that tells CDK to re-use existing EKS cluster. The cluster must have AWS ALB, EFS, VPC, External Secrets and FluentBit add-ons installed and configured. See [EKS Blueprints AddOns](https://aws-quickstart.github.io/cdk-eks-blueprints/addons/) section for more information.                                                                                   |
| eks.securityGroupId            | Yes, if `eks.clusterName` is set | sg-0c123122333123                           | EKS cluster security group ID                                                                                                                                                                                                                                                                                                                                                    |
| eks.kubectlRoleArn             | Yes, if `eks.clusterName` is set | arn:aws:iam::122333:role/eksClusterRole     | Admin IAM role of the EKS cluster. Requires permissions similar to the role created by EKS Blueprints, see [code](https://github.com/aws/aws-cdk/blob/a2c633f1e698249496f11338312ab42bd7b1e4f0/packages/aws-cdk-lib/aws-eks/lib/cluster-resource.ts#L116) for reference.                                                                                                         |
| eks.default.private-cluster    | No                               | true                                        | Controls whether EKS cluster is public or private. By default this solution provides private endpoints only. If you limit access to private endpoints, setup a jumpbox with SSM Agent following this documentaiton section: https://aws-quickstart.github.io/cdk-eks-blueprints/addons/ssm-agent/#use-case-private-clusters                                                      |
| eks.default.min-size           | No                               | 1                                           | Min cluster size, must be positive integer greater than 0 (default 1).                                                                                                                                                                                                                                                                                                           |
| eks.default.max-size           | No                               | 5                                           | Max cluster size, must be greater than minSize (default 5).                                                                                                                                                                                                                                                                                                                      |
| eks.default.desired-size       | No                               | 3                                           | Desired cluster size, must be greater or equal to minSize (default min-size).                                                                                                                                                                                                                                                                                                    |
| eks.default.instance-type      | No                               | m5.4xlarge                                  | Type of instance for the EKS cluster, must be a valid instance type, i.e. t3.medium (default "m5.4large") [documentation](https://aws-quickstart.github.io/cdk-eks-blueprints/cluster-providers/mng-cluster-provider/)                                                                                                                                                           |
| rds.minCapacity                | Yes                              | 2                                           | The minimum capacity for an Aurora Serverless database cluster. [documentation](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v1.how-it-works.html#aurora-serverless.how-it-works.auto-scaling)                                                                                                                                                 |
| rds.maxCapacity                | Yes                              | 16                                          | The maximum capacity for an Aurora Serverless database cluster. [documentation](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v1.how-it-works.html#aurora-serverless.how-it-works.auto-scaling)                                                                                                                                                 |
| rds.autoPause                  | Yes                              | 5                                           | The time before an Aurora Serverless database cluster is paused. A database cluster can be paused only when it is idle (it has no connections). Auto pause time must be between 5 minutes and 1 day. Set to 0 to disable                                                                                                                                                         |
| rds.snapshotRetentionInDays    | Yes                              | 1                                           | Aurora Serverless has daily snapshots enabled by default with 1 day retention policy. You can use this setting to adjust retention policy in days.                                                                                                                                                                                                                               |
| rabbitmq.cluster               | Yes                              | false                                       | Deploys multi-AZ cluster if set to true. Single instance otherwise. [Documentation](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-amazonmq-broker.html#cfn-amazonmq-broker-deploymentmode)                                                                                                                                                          |
| rabbitmq.instance              | Yes                              | mq.t3.micro                                 | The broker's instance type. [documentation](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-amazonmq-broker.html#cfn-amazonmq-broker-hostinstancetype)                                                                                                                                                                                                |
| galaxy.adminEmails             | Yes                              | user1@domain.com,user2@domain.com           | A comma separated list of emails of admin users                                                                                                                                                                                                                                                                                                                                  |
| galaxy.namespace               | Yes                              | galaxy                                      | EKS namespace used to deploy Galaxy.                                                                                                                                                                                                                                                                                                                                             |
| galaxy.refdataEnabled          | Yes                              | true                                        | Whether or not to mount cloud-hosted Galaxy reference data and tools.                                                                                                                                                                                                                                                                                                            |
| galaxy.backupsEnabled          | Yes                              | true                                        | Enables RDS and EFS backups using AWS Backups. By default this takes daily backups with 35 day retention and monthly backups with 1 year retention period.                                                                                                                                                                                                                       |
| galaxy.logLevel                | Yes                              | WARNING                                     | Possible values: CRITICAL, ERROR, WARNING, INFO, DEBUG, NOTSET (https://docs.python.org/3/library/logging.html#logging-levels).                                                                                                                                                                                                                                                  |
| galaxy.additionalSetupCommands | No                               | /galaxy/server/.venv/bin/pip3 install ldap3 | Additional commands performed before the start of the galaxy web server. Example installs the python-ldap3 library to allow LDAP/LDAPS connections to Active Directory.                                                                                                                                                                                                          |
| galaxy.elbCertArn              | No                               | arn:aws:acm:us-east-1:122333:certificate/ce | ARN of a certificate in Amazon Certificate Manager. Enables TLS/SSL communication with the load balancer fronting Galaxy                                                                                                                                                                                                                                                         |
| galaxy.elbAccessLogsBucketname | No                               | galaxy-alb-access-log-bucket                | Specify a name of the existing S3 bucket name to store the Elastic Load Balancer stores [access logs](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-access-logs.html). The bucket requires a compliant [bucket policy](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html#attach-bucket-policy). |
| cloudwatch.logRetentionDays    | Yes                              | 30                                          | Retention policy in days for newly created CloudWatch log groups. If set to 0, logs will never expire.                                                                                                                                                                                                                                                                           |

For additional EKS and VPC configuration settings, refer to the EKS Blueprints [Quick Start Guide](https://aws-quickstart.github.io/cdk-eks-blueprints/).

##### Logging and Amazon CloudWatch integration

This solution uses [FluentBit](https://fluentbit.io/) to collect infrastructure and application-level logs in the following log groups:

- `/aws/eks/fluentbit-cloudwatch/logs`
- `/aws/eks/fluentbit-cloudwatch/workload/external-secrets`
- `/aws/eks/fluentbit-cloudwatch/workload/galaxy`
- `/aws/eks/fluentbit-cloudwatch/workload/kube-system`

By default, these log groups have a 30 days retention policy that can be modified with the `cloudwatch.logRetentionDays` parameter in CDK context.

Amazon MQ, Amazon Aurora, Amazon EFS and other AWS managed services send their operational metrics to CloudWatch, up to every minute.

##### Custom domains and SSL

In the default configuration, this solution will deploy Galaxy behind a publicly available load balancer with a DNS name similar to `k8s-galaxy-123456789.us-east-1.elb.amazonaws.com`. If you want to use custom DNS records and Transport Layer Security (TLS) certificates for HTTPS connections to Galaxy, you can associate DNS records with the load balancer and set TLS certificates via EKS Ingress Controller annotation using `galaxy.elbCertArn` context setting. Follow the step-by-step instructions provided in the [How do I use TLS certificates to activate HTTPS connections for my Amazon EKS applications?](https://repost.aws/knowledge-center/eks-apps-tls-to-activate-https) post on AWS Knowledge center.

##### Autoscaling

The Guidance allows for both horiztonal as well as vertical scaling. The EKS Blueprints used in this solution come with the Cluster Autoscaler add-on, which automatically adjusts the number of EC2 nodes in your cluster when pods fail due to insufficient resources (not enough EC2 instances in the cluster) or when pods are rescheduled onto other nodes due to being in nodes that are underutilized for an extended period of time (too many EC2 instances in the cluster).

To enable horizontal scaling on the pod level, use the `kubectl` tool to set autoscaling configuration and targets:

```bash
kubectl autoscale deployment galaxy-web --cpu-percent=50 --min=1 --max=10
```

This command will enable autoscaling when pod CPU usage is higher than 50%, with a maximum of 10 pods and a minimum of 1 pod. It is recommended to apply horizontal pod scaling to the `galaxy-web`, `galaxy-workflow`, and `galaxy-job` services in the cluster.

For additional information on horizontal scaling, refer to the [Galaxy Horizontal Scaling](https://github.com/galaxyproject/galaxy-helm/#horizontal-scaling) documentation and the [Kubernetes Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/) documentation.

#### Application configuration

Galaxy application level configuration is provided as Kubernetes Helm chart values set in the `lib/application-stack.ts` file. A full list of available parameters and their default values can be found in the [Configuration](https://github.com/galaxyproject/galaxy-helm/tree/master#configuration) section of the `galaxy-helm` repository's Readme. Additionally, all `.xml`, `.yml`, and `.conf` files in the `configs` directory will be passed to the Galaxy chart as `values.configs` to be created on a Galaxy server.

##### Authentication and Active Directory integration

Galaxy supports various [authentication mechanisms](https://docs.galaxyproject.org/en/latest/admin/authentication.html#authentication-framework) via its own database or federated authentication through LDAP/Active Directory and PAM. These methods can be configured using the `configs/auth_conf.xml` file, which will be copied to the appropriate location on the Galaxy servers. You can find a template file with detailed explanations on [GitHub](https://github.com/galaxyproject/galaxy/blob/dev/lib/galaxy/config/sample/auth_conf.xml.sample). This solution was tested with [AWS Managed Microsoft AD](https://docs.aws.amazon.com/directoryservice/latest/admin-guide/directory_microsoft_ad.html) using the following configuration:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<auth>
   <authenticator>
      <type>ldap3</type>
      <options>
         <server>ldap://domaincontrollers.example.com</server>
         <allow-register>False</allow-register>
         <allow-password-change>False</allow-password-change>
         <login-use-username>False</login-use-username>
         <continue-on-failure>False</continue-on-failure>
         <search-base>ou=users,ou=department,dc=example,dc=com</search-base>
         <search-fields>sAMAccountName,mail</search-fields>
         <search-user>cn=queryrole,ou=users,ou=department,dc=example,dc=com</search-user>
         <search-password>queryrolepassword</search-password>
         <search-filter>(&amp;(objectClass=user)(mail={email}))</search-filter>
         <auto-register-username>{sAMAccountName}</auto-register-username>
         <auto-register-email>{email}</auto-register-email>
         <auto-register-roles>{gidNumber}</auto-register-roles>
         <auto-register>True</auto-register>
         <auto-create-roles>False</auto-create-roles>
         <auto-create-groups>False</auto-create-groups>
         <auto-assign-roles-to-groups-only>False</auto-assign-roles-to-groups-only>
         <bind-user>{dn}</bind-user>
         <bind-password>{password}</bind-password>
      </options>
   </authenticator>
</auth>
```

Explanation of the key configuration parameters:

- `server`: Connect to the domain controllers on `domaincontrollers.example.com`. To increase the resilience of this deployment, it is best practice to point to a DNS record rather than the Active Directory endpoint directly, to avoid the Domain Controller becoming a potential single point of failure.
- `allow-register/allow-password-change` Disables Galaxy's native user management.
- `search-base`: Allows users matching `ou=users,ou=department,dc=example,dc=com` to log in.
- `search-user`/`search-password`: Leverages the user `queryrole`, given by `cn=queryrole,ou=users,ou=department,dc=example,dc=com` to query Active Directory. The `searchUser` is a service account that should be configured with the minimum levels of permissions to perform AD queries.

With the configuration file ready, you can complete Active Directory integration by following the next steps:

- As the current version of the Galaxy Helm chart does not include the needed python library[ldap3](https://ldap3.readthedocs.io/en/latest/), install it manually before the web server starts by using the `additionalSetupCommands` context variable: `"galaxy.additionalSetupCommands": "/galaxy/server/.venv/bin/pip3 install ldap3"`.
- LDAP 3 requires Active Directory to support [StartTLS](https://datatracker.ietf.org/doc/html/rfc2830) to upgrade LDAP to LDAPS. AWS Managed Microsoft AD StartTLS can be configured by following the steps in the [documentation](https://docs.aws.amazon.com/directoryservice/latest/admin-guide/ms_ad_ldap_server_side.html).
- Make sure Galaxy servers can establish a TCP connection to the Active Directory Domain Controllers on port 389 for LDAP and port 636 for LDAPS. This solution configures the Security Groups and Network Access Control Lists to permit those connections, but additional configuration, like [configuring routing tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html), may be needed if the Domain Controllers are in a different VPC/Network.



## Cleanup

> **Warning**
> Instructions in this section delete both the Amazon EFS file system and the Amazon RDS Aurora database. The database is configured by default to be protected from deleting. Make sure you don't need the data stored there and have backups of the data. Disable this deletion protection for the Amazon RDS Aurora database in this case.

Run the following command to destroy the CDK application and all infrastructure components used by Galaxy:

```bash
cdk destroy --all
```

This command will delete VPC, EKS Cluster, Galaxy application, and other infrastructure dependencies. If the CloudFormation stack is stuck in DELETE FAILED for more than 1 hour, make sure RDS, EFS and ELB with its target groups are deleted. You might need to remove those resources manually in AWS Console or AWS CLI.

If you enabled backups or reference data, there might be data stored in [AWS Backup](https://console.aws.amazon.com/backup/home/) or [Amazon Simple Storage Service](https://s3.console.aws.amazon.com/s3/home) and continue to produce costs.


## Notices

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.
This library is licensed under the MIT-0 License. See the LICENSE file.
