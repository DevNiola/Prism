# Kubernetes deployment

The Kustomize production overlay deploys the web app, API server, and a
persistent single-node Redis instance:

```sh
kubectl apply -k deploy/k8s/overlays/production
```

Before applying it, update `overlays/production/ingress-patch.yaml` with your
public hostname and configure the TLS issuer annotation in `base/ingress.yaml`
for the cert-manager `ClusterIssuer` installed in your cluster. The overlay
expects an NGINX Ingress controller. DNS for the hostname must point to that
controller.

Build and publish the web and server images as
`ghcr.io/devniola/prism-web:0.1.0` and
`ghcr.io/devniola/prism-server:0.1.0`, or change the image names and tags in the
production overlay to match your registry. Ensure the server image includes
the app's compiled `dist/index.js` and its production Node dependencies.

Set the optional AI provider key in `base/secret.yaml` before applying, or
replace the Secret through your cluster's secret-management tooling. The
included value is empty and enables deployments that do not use AI features.
Redis data is stored in an 8 GiB persistent volume; the cluster must provide a
default StorageClass or the claim must be configured with a `storageClassName`.
