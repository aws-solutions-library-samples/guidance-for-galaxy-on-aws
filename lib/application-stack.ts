import 'source-map-support/register';
import fs = require("fs");
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as amazonmq from 'aws-cdk-lib/aws-amazonmq';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

function loadConfigs() {
  const configsPath = __dirname + "/../configs/";
  const files = fs.readdirSync(configsPath).filter((elm) =>
    [".xml", ".conf", ".yml"].some((s) => elm.endsWith(s))
  );

  const configFiles: Record<string, string> = {};

  files.forEach((filename) => {
    configFiles[filename] = fs.readFileSync(configsPath + filename).toString();
  });

  return configFiles;
}

function addCertificateToLoadbalancer(arn: String){
  return arn? {"alb\.ingress\.kubernetes\.io/certificate-arn": arn} : {};
}

export interface ApplicationStackProps extends cdk.StackProps {
  eksCluster: eks.ICluster;
  databaseCluster: rds.ServerlessCluster;
  rabbitmqCluster: amazonmq.CfnBroker;
  rabbitmqSecret: secretsmanager.ISecret;
  fileSystem: efs.IFileSystem;
}

export class ApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    const namespace: string = this.node.tryGetContext('galaxy.namespace');
    const refdataEnabled: boolean = this.node.tryGetContext('galaxy.refdataEnabled');

    const efsStorageClass = new eks.KubernetesManifest(this, "efsStorageClass", {
      cluster: props.eksCluster,
      overwrite: true,
      manifest: [
        {
          "kind": "StorageClass",
          "apiVersion": "storage.k8s.io/v1",
          "metadata": {
            "name": "efs-sc"
          },
          "provisioner": "efs.csi.aws.com",
          "mountOptions": [
            "tls"
          ],
          "parameters": {
            "provisioningMode": "efs-ap",
            "fileSystemId": props.fileSystem.fileSystemId,
            "directoryPerms": "700",
            "gidRangeStart": "1000",
            "gidRangeEnd": "2000",
            "basePath": "/dynamic_provisioning"
          }
        },
      ]
    });

    efsStorageClass.node.addDependency(props.fileSystem.mountTargetsAvailable);

    const galaxyEKSSecretStore = new eks.KubernetesManifest(this, "galaxyEKSSecretStore", {
      cluster: props.eksCluster,
      overwrite: true,
      manifest: [
        {
          apiVersion: "external-secrets.io/v1beta1",
          kind: "ClusterSecretStore",
          metadata: {
            name: "aws-secretsmanager",
          },
          spec: {
            provider: {
              aws: {
                service: "SecretsManager",
                region: cdk.Stack.of(this).region,
                auth: {
                  jwt: {
                    serviceAccountRef: {
                      name: "external-secrets-sa",
                      namespace: "external-secrets",
                    },
                  },
                },
              },
            },
          },
        },
      ]
    });

    const galaxyEKSNamespace = new eks.KubernetesManifest(this, "galaxyEKSNamespace", {
      cluster: props.eksCluster,
      overwrite: true,
      manifest: [
        {
          apiVersion: "v1",
          kind: "Namespace",
          metadata: {
            name: namespace,
          },
        },
      ]
    });

    const galaxyEKSSecretPostgresql = new eks.KubernetesManifest(this, "galaxyEKSSecretPostgresql", {
      cluster: props.eksCluster,
      overwrite: true,
      manifest: [
        {
          apiVersion: "external-secrets.io/v1beta1",
          kind: "ExternalSecret",
          metadata: {
            name: "galaxy.credentials.postgresql",
            namespace: namespace,
          },
          spec: {
            secretStoreRef: {
              name: "aws-secretsmanager",
              kind: "ClusterSecretStore",
            },
            target: {
              name: "galaxy.credentials.postgresql",
              creationPolicy: "Orphan",
            },
            data: [
              {
                secretKey: "username",
                remoteRef: {
                  key: props.databaseCluster.secret?.secretName,
                  property: "username",
                },
              },
              {
                secretKey: "password",
                remoteRef: {
                  key: props.databaseCluster.secret?.secretName,
                  property: "password",
                },
              },
            ],
          },
        },
      ]
    });

    galaxyEKSSecretPostgresql.node.addDependency(galaxyEKSNamespace, galaxyEKSSecretStore);

    const galaxyEKSSecretRabbitmq = new eks.KubernetesManifest(this, "galaxyEKSSecretRabbitmq", {
      cluster: props.eksCluster,
      overwrite: true,
      manifest: [
        {
          apiVersion: "external-secrets.io/v1beta1",
          kind: "ExternalSecret",
          metadata: {
            name: "galaxy.credentials.rabbitmq",
            namespace: namespace,
          },
          spec: {
            secretStoreRef: {
              name: "aws-secretsmanager",
              kind: "ClusterSecretStore",
            },
            target: {
              name: "galaxy.credentials.rabbitmq",
              creationPolicy: "Orphan",
            },
            data: [
              {
                secretKey: "username",
                remoteRef: {
                  key: props.rabbitmqSecret.secretName,
                  property: "username",
                },
              },
              {
                secretKey: "password",
                remoteRef: {
                  key: props.rabbitmqSecret.secretName,
                  property: "password",
                },
              },
            ],
          },
        },
      ],
    });

    galaxyEKSSecretRabbitmq.node.addDependency(galaxyEKSNamespace, galaxyEKSSecretStore);
    const s3csiValues = {
      deploy: false, // deployed outside of Galaxy Helm
      storageClass: {
        name: "refdata-gxy-data",
        mounter: "geesefs",
        singleBucket: "biorefdata",
        mountOptions: "-o allow_other --dir-mode 0777 --file-mode 0666 --cache /tmp/geesecache --stat-cache-ttl 9m0s --cache-to-disk-hits 1 --no-dir-object --no-implicit-dir --stat-cache-ttl 120m0s --max-disk-cache-fd 4096",
      },
      secret: {
        create: false,
        usePrefix: true,
        prefix: "/galaxy/v1",
      }
    };

    const galaxyChart = new eks.HelmChart(this, 'galaxyChart', {
      cluster: props.eksCluster,
      chart: 'galaxy',
      release: 'galaxy',
      repository: 'https://raw.githubusercontent.com/CloudVE/helm-charts/master/',
      namespace: namespace,
      timeout: cdk.Duration.minutes(10),
      values: {
        configs: {
          "galaxy.yml": {
            galaxy: {
              admin_users: this.node.tryGetContext("galaxy.adminEmails"),
              require_login: true,
              show_welcome_with_login: true,
              log_level: this.node.tryGetContext("galaxy.logLevel")
            },
          },
          ...loadConfigs(),
        },
        // Needed as Helm currently does not check and install dependencies 
        extraInitCommands: this.node.tryGetContext("galaxy.additionalSetupCommands"),
        extraFileMappings: {
          "/galaxy/server/static/welcome.html": {
            content: `      
              <!DOCTYPE html>
              <html lang="en">
                  <head>
                      <meta charset="utf-8">
                      <link rel="stylesheet" href="style/base.css" type="text/css" />
                  </head>
                  <body class="m-0">
                      <div class="py-4">
                          <div class="container">
                              <h2>Welcome to <strong>Galaxy v{{ .Chart.AppVersion }} on AWS</strong></h2>
                              <br>
                              <a target="_blank" href="https://docs.galaxyproject.org/en/master/" class="btn btn-primary">Documentation »</a>
                              <a target="_blank" href="https://galaxyproject.org" class="btn btn-primary">Community Hub »</a>
                          </div>
                          <br>
                          {{- if .Values.influxdb.enabled }}
                          <div class="container">
                              <iframe width="100%" height="1300px" frameborder="0" marginheight="0" marginwidth="0"
                                  src="/grafana/d/gxy_general_stats_{{ .Release.Name }}/galaxy-overview?refresh=60s&orgId=1&kiosk&theme=light"></iframe>
                          </div>
                          {{- end }}
                      </div>
                      <div class="container">
                          <footer class="text-center">
                              <p>Galaxy v{{ .Chart.AppVersion }}, Helm Chart v{{ .Chart.Version }}</p>
                          </footer>
                      </div>
                  </body>
              </html>`,
          }
        },
        rabbitmq: {
          deploy: false,
          port: 5671,
          protocol: "amqps",
          existingCluster: cdk.Fn.importValue('rabbitmqEndpoint'),
          existingSecret: 'galaxy.credentials.rabbitmq',
        },
        postgresql: {
          deploy: false,
          existingDatabase: props.databaseCluster.clusterEndpoint.hostname,
          galaxyConnectionParams: "",
          galaxyExistingSecret: 'galaxy.credentials.postgresql',
        },
        refdata: {
          enabled: refdataEnabled,
          type: "s3csi",
        },
        s3csi: s3csiValues,
        cvmfs: {
          deploy: false,
        },
        ingress: {
          path: "/",
          hosts: [
            {
              paths: [
                { path: "/*" }
              ]
            }
          ],
          ingressClassName: "alb",
          annotations: {
            "alb\.ingress\.kubernetes\.io/target-type": "ip",
            "alb\.ingress\.kubernetes\.io/group\.name": "galaxy",
            "alb\.ingress\.kubernetes\.io/scheme": "internet-facing",
            "alb\.ingress\.kubernetes\.io/group\.order": "99",
            ...addCertificateToLoadbalancer(this.node.tryGetContext('galaxy.loadBalancerCertArn'))
          },
          canary: {
            enabled: false,
          },
        },
        tusd: {
          ingress: {
            ingressClassName: "alb",
            annotations: {
              "alb\.ingress\.kubernetes\.io/target-type": "ip",
              "alb\.ingress\.kubernetes\.io/group\.name": "galaxy",
              "alb\.ingress\.kubernetes\.io/scheme": "internet-facing",
              ...addCertificateToLoadbalancer(this.node.tryGetContext('galaxy.loadBalancerCertArn'))
            },
          },
        },
        persistence: {
          storageClass: "efs-sc",
          accessMode: "ReadWriteMany",
        }
      }
    });

    galaxyChart.node.addDependency(efsStorageClass, galaxyEKSSecretPostgresql, galaxyEKSSecretRabbitmq);

    if (refdataEnabled) {
      const csiS3Secret = new eks.KubernetesManifest(this, "csiS3Secret", {
        cluster: props.eksCluster,
        overwrite: true,
        manifest: [
          {
            apiVersion: "v1",
            kind: "Secret",
            metadata: {
              namespace: namespace,
              name: "csi-s3-secret",
            },
            stringData: {
              accessKeyID: "",
              secretAccessKey: "",
              endpoint: "https://s3.ap-southeast-2.amazonaws.com",
            }
          },
        ]
      });

      csiS3Secret.node.addDependency(galaxyEKSNamespace);

      // newest version and original image (no overrides in values.yaml)
      const csiS3Chart = new eks.HelmChart(this, 'csiS3', {
        cluster: props.eksCluster,
        chart: 'csi-s3',
        release: 'csi-s3',
        repository: 'https://raw.githubusercontent.com/CloudVE/helm-charts/master/',
        namespace: namespace,
        values: s3csiValues,
      });

      csiS3Chart.node.addDependency(csiS3Secret);
      galaxyChart.node.addDependency(csiS3Chart);
    }

    const galaxyDNS = new eks.KubernetesObjectValue(this, 'galaxyDNS', {
      cluster: props.eksCluster,
      objectType: "ingress",
      objectNamespace: namespace,
      objectName: 'galaxy',
      jsonPath: '.status.loadBalancer.ingress[0].hostname',
    })

    galaxyDNS.node.addDependency(galaxyChart);

    new cdk.CfnOutput(this, 'galaxyDNSOutput', { value: galaxyDNS.value });
  }
}
