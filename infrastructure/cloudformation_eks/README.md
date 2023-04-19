# Readme

based on https://github.com/aws-solutions-library-samples/aws-batch-arch-for-protein-folding

## TODO
[x] enable TLS on ELB - configurable via CFN
[x] priority in ELB target group for file uploads
[] EKS figure out this WebACL role error (see deployment/pod event logs)
[] cvmf, s3csi, refdata enable
[x] merge https://github.com/galaxyproject/galaxy-helm/pull/421
[] Helm/CFN grafana dashboards
[] CFN move creation of VPC in
[] CFN create rabbit and postgresql + secrets
[] CFN option to choose public/private ELB
[] CFN + Helm EFS
[] EKS + Galaxy autoscaling
[] Helm test workflows
[] cloudwatch logs saves password when setting secrets
[] make sure rabbitmq and RDS are actually used

## Deployment notes

1. package

aws cloudformation package --template-file infrastructure/cloudformation/galaxy-cfn-root.yaml --output-template output/galaxy-cfn.yaml --s3-bucket cf-templates-1qkizr8ed2w3f-us-east-2 --s3-prefix galaxy --region us-east-2

1. AWSQS create a role as described in repo https://github.com/aws-quickstart/quickstart-helm-resource-provider
2. AWSQS:HELM activate
3. Deploy CFN templates

kubectl apply -f ./secret.yaml
kubectl apply -f ./secret-rabbitmq.yaml

kubectl apply -f ./service-rabbitmq.yaml




helm upgrade --create-namespace -n galaxy galaxystack . \
--set rabbitmq.deploy=false \
--set rabbitmq.port=5671 \
--set rabbitmq.protocol=amqps \
--set rabbitmq.existingCluster=b-cad46958-5e24-4f4d-a38b-5db68c173f9c.mq.us-east-2.amazonaws.com \
--set rabbitmq.existingSecret=galaxy.credentials.rabbitmq \
--set postgresql.deploy=false \
--set postgresql.existingDatabase=galaxy.cluster-cjoxqnk9nks2.us-east-2.rds.amazonaws.com \
--set postgresql.galaxyDatabaseUser=galaxyuser \
--set postgresql.galaxyConnectionParams="" \
--set postgresql.galaxyExistingSecret=galaxydbuser.credentials.postgresql \
--set cvmfs.deploy=false \
--set refdata.enabled=false \
--set s3csi.deploy=false \
--set ingress.path="/" \
--set ingress.hosts[0].paths[0].path="/*" \
--set ingress.ingressClassName="alb" \
--set ingress.annotations."alb\.ingress\.kubernetes\.io/target-type"="ip" \
--set ingress.annotations."alb\.ingress\.kubernetes\.io/group\.name"="galaxy" \
--set ingress.annotations."alb\.ingress\.kubernetes\.io/scheme"="internet-facing" \
--set-string ingress.annotations."alb\.ingress\.kubernetes\.io/group\.order"="99" \
--set ingress.canary.enabled=false \
--set tusd.ingress.ingressClassName="alb" \
--set tusd.ingress.annotations."alb\.ingress\.kubernetes\.io/target-type"="ip" \
--set tusd.ingress.annotations."alb\.ingress\.kubernetes\.io/group\.name"="galaxy" \
--set tusd.ingress.annotations."alb\.ingress\.kubernetes\.io/scheme"="internet-facing" \
--set persistence.accessMode="ReadWriteOnce"








helm uninstall -n galaxy galaxystack
kubectl delete all --all -n galaxy
psql postgresql://galaxyuser:galaxypassword@galaxy-instance-1.cjoxqnk9nks2.us-east-2.rds.amazonaws.com/ -c "DROP DATABASE galaxy;"
