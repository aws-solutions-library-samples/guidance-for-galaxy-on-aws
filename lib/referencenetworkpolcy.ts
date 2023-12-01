    if (true) {
      const galaxyNetworkPolicy = new eks.KubernetesManifest(
        this,
        'galaxy-network-policy',
        {
          cluster: props.eksCluster,
          overwrite: true,
          manifest: [
            {
              apiVersion: 'networking.k8s.io/v1',
              kind: 'NetworkPolicy',
              metadata: {
                name: 'default-deny-cross-namespace',
                namespace: namespace,
              },
              spec: {
                podSelector: {},
                policyTypes: ['Ingress'],
                ingress: [
                  {
                    from: [
                      {
                        namespaceSelector: {
                          matchExpressions: [
                            {
                              key: 'namespace',
                              operator: 'In',
                              values: [namespace],
                            },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }
      );
    }

    apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: test-network-policy
  namespace: galaxy
spec:
  podSelector: {}
  policyTypes: ['Ingress']
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: galaxy
    from:
    - namespaceSelector:
        matchLabels:
          name: kube-system


      // If the cluster was newly created, add network policies
      if (!existingEksName && false) {
        for (const ns of [
          'default',
          'kube-public',
          'kube-node-lease',
          'external-secrets'
        ])
          this.eksCluster.addManifest(ns, {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'NetworkPolicy',
            metadata: {
              name: 'default-deny-cross-namespace',
              namespace: ns,
            },
            spec: {
              podSelector: {},
              policyTypes: ['Ingress', 'Egress'],
              ingress: [
                {
                  from: [
                    {
                      namespaceSelector: {
                        matchExpressions: [
                          {
                            key: 'namespace',
                            operator: 'In',
                            values: [ns],
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
              egress: [
                {
                  to: [
                    {
                      namespaceSelector: {
                        matchExpressions: [
                          {
                            key: 'namespace',
                            operator: 'In',
                            values: [ns],
                          },
                        ],
                      },
                    },
                  ],
                },
                {
                  ports: [
                    {
                      port: 443,
                      protocol: 'TCP',
                    },
                  ],
                  to: [
                    {
                      ipBlock: {
                        cidr: '172.20.0.1/32' // Kubernetes CoreDNS
                      }
                    },
                    {
                      ipBlock: {
                        cidr: '10.0.0.2/32' // AWS DNS
                      }
                    },
                  ],
                },
              ],
            },
          });