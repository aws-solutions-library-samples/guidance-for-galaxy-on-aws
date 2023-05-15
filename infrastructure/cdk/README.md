# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template

# Welcome to the AWS Galaxy for Enterprise CDK Blueprint

some abstract info text here

## Autoscaling

We have prepared this deployment to manage you horizontal autoscaling with EKS in a full automatically way.
For this deployment we use the CDK/EKS blueprints. For more information about the blueprint, read here: https://aws-quickstart.github.io/cdk-eks-blueprints/

The easiest way to configure you individual autoscaling for galaxy is this:

`kubectl autoscale deployment galaxy-web --cpu-percednt=50 --min=1 --max=10`

This means, that the autoscaling will start on 50% cpu usage with a maximum amount of 10 pods and minimum 1 pod.
The recommended deployments in galaxy for a horizontal scaling are:

`galaxy-web`, `galaxy-workflow` and `galaxy-job`

More resources about the horizontal pod autoscaler (hpa) and galaxy autoscaling:

- https://aws-quickstart.github.io/cdk-eks-blueprints/addons/cluster-autoscaler/
- https://github.com/galaxyproject/galaxy-helm/#horizontal-scaling

For additional node autoscaling, you can configure a kubernetes cluster autoscaler with the aws cloud provider instructions:

- https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/cloudprovider/aws/README.md