
# Rolloutary



Rolloutary is a DevOps engineering project that automates application testing, Docker image publishing, Kubernetes staging deployments, and post-deployment verification using GitHub Actions.

The project demonstrates how a code change can move through an automated delivery pipeline into a Kubernetes environment.

## Features Implemented

- **Continuous Integration:** Checks JavaScript syntax and runs automated unit tests.
- **Containerization:** Packages the Node.js application using Docker.
- **Container Registry:** Publishes versioned Docker images to GitHub Container Registry (GHCR).
- **Automated Staging Deployment:** Uses a self-hosted Windows GitHub Actions runner to deploy to Kubernetes.
- **Rolling Updates:** Updates the Kubernetes Deployment while maintaining available replicas.
- **Health Checks:** Provides application health and readiness endpoints.
- **Deployment Verification:** Checks rollout status and Kubernetes pod health.
- **Secure Configuration:** Uses Kubernetes image pull secrets for private container images.

## Architecture

```text
Developer
   |
   v
GitHub Repository
   |
   v
GitHub Actions CI
   |
   +--> Install dependencies
   +--> Check JavaScript syntax
   +--> Run unit tests
   |
   v
Build and Publish Docker Image
   |
   v
GitHub Container Registry
   |
   v
Self-Hosted GitHub Actions Runner
   |
   v
Kubernetes Staging Deployment
   |
   +--> Rolling update
   +--> Readiness and liveness probes
   +--> Rollout verification
   |
   v
Running Application
```

## Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | Application runtime |
| Docker | Application containerization |
| GitHub Actions | CI/CD automation |
| GitHub Container Registry | Container image storage |
| Kubernetes | Staging deployment orchestration |
| PowerShell | Deployment automation on Windows |
| Git | Version control |

## Application Endpoints

| Endpoint | Purpose |
|---|---|
| `/` | Returns the Rolloutary welcome message |
| `/health` | Reports application health |
| `/ready` | Reports readiness for traffic |

## Local Development

### Prerequisites

- Node.js 20 or newer
- npm
- Docker, if building the container locally

### Install dependencies

```bash
cd app
npm ci
```

### Run automated tests

```bash
npm test
```

### Check JavaScript syntax

```bash
npm run lint
```

### Build the Docker image

From the repository root:

```bash
docker build -t rolloutary:local ./app
```

### Run the container

```bash
docker run --rm -p 8080:8080 rolloutary:local
```

Open `http://localhost:8080/` to access the application.

## Kubernetes Staging

Rolloutary uses Kubernetes manifests under `k8s/staging/`.

The current staging configuration uses:

- Namespace: `staging`
- Deployment: `myapp`
- Desired replicas: `2`
- Service type: `ClusterIP`
- Container port: `8080`
- Health and readiness probes

The staging environment currently runs on a local Docker Desktop Kubernetes cluster.

### Verify the deployment

```bash
kubectl get deployment myapp -n staging
kubectl get pods -n staging
kubectl get service myapp -n staging
```

### Access the application locally

```bash
kubectl port-forward service/myapp 8082:80 -n staging
```

With port forwarding running, open `http://localhost:8082/`.

The port-forward command must remain active while using this local URL.

## CI/CD Workflow

The workflow is defined in `.github/workflows/ci.yml`.

1. GitHub Actions checks out the repository.
2. Dependencies are installed and application tests run.
3. A Docker image is built and published to GHCR.
4. The self-hosted Windows runner verifies Kubernetes connectivity.
5. The published image is deployed to the staging namespace.
6. Kubernetes rollout status and pod health are verified.

Pull requests run the validation job. Pushes trigger image publishing, and pushes to `main` also trigger the staging deployment.

## Current Status

**Implemented and verified:**

- Application endpoints and automated unit tests
- Docker image build
- GitHub Actions test and build jobs
- Image publishing to GHCR
- Kubernetes staging deployment
- Two ready staging replicas
- Automated staging rollout verification

**Planned future improvements:**

- Terraform-based infrastructure provisioning
- Container vulnerability scanning and dependency auditing
- Prometheus metrics and Grafana dashboards
- Canary or blue-green deployment strategies
- Ephemeral environments for pull requests
- Production deployment and rollback automation
- Deployment performance and reliability metrics

These planned features are not represented as completed capabilities.

## Security Notes

- Never commit personal access tokens, credentials, kubeconfig files, or other secrets.
- Use GitHub Actions secrets and Kubernetes secrets for sensitive configuration.
- Apply least-privilege permissions wherever practical.
- Review container and dependency vulnerabilities before production use.

## Limitations

Rolloutary is an educational DevOps engineering project. Its staging environment currently runs locally and is not a permanently hosted public service.

Production readiness, high availability, security guarantees, and performance targets require additional implementation and testing.

## License

MIT. See the `LICENSE` file for the applicable terms.
Rolloutary CI/CD staging deployment verification.
