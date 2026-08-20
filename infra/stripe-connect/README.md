# Stripe Connect infrastructure

This tree defines the isolated, staging-only Stripe Connect control-plane
foundation. It is intentionally separate from the default QuotePilot Firebase
database, legacy payment functions, and production project.

## Safety boundary

- `terraform apply` is not authorized by source review, CI, or merge.
- No Stripe credential, webhook secret, provider object, secret version, or
  production environment is represented here.
- The staging root keeps App Check registration `false`; creating the public
  key and Firebase binding is a separately reviewed provider mutation.
- The named database has deletion protection and `prevent_destroy`; the fixed
  egress address and state bucket are also protected from routine destruction.
- Runtime database roles carry an exact `connect-control` IAM condition. The
  runtime identities receive no default-database role from this module.
- GitHub OIDC admission requires the immutable repository ID, immutable owner
  ID, `main`, and the protected `stripe-connect-staging` environment. No
  service-account key is created.

## Validation only

```bash
npm run check:stripe-connect:infra
npm run check:stripe-connect:staging
terraform fmt -check -recursive infra/stripe-connect
terraform -chdir=infra/stripe-connect/bootstrap/staging init -backend=false
terraform -chdir=infra/stripe-connect/bootstrap/staging validate
terraform -chdir=infra/stripe-connect/environments/staging init -backend=false
terraform -chdir=infra/stripe-connect/environments/staging validate
```

These commands parse and validate source. They do not authenticate, refresh
cloud state, produce a trusted plan, or create infrastructure. The live staging
preflight is read-only: it confirms the exact staging project/app inventory and
the required `connect-control` named database contract, but it does not create
that database or bind runtime/provider access.

## Future authorized sequence

1. Review the exact staging project, billing, Firestore location, repository
   IDs, protected GitHub environment, and state-bucket name.
2. Bootstrap the versioned state bucket with a separately approved operator.
3. Initialize the staging root with `-backend-config=staging.tfbackend`.
4. Produce and review a saved plan using short-lived Google credentials.
5. Apply only after an explicit authorization naming that saved-plan digest.
6. Deploy `firestore.connect-control.rules` to the named database, reconcile
   Terraform outputs into the secret-free manifest, and collect hosted IAM,
   fixed-egress, App Check monitoring, and rollback evidence.

Production remains intentionally absent. It will require its own root, backend,
manifest, state, authorization, and evidence package.
