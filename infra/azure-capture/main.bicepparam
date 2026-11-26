using './main.bicep'

// Replace every placeholder in a private local copy before deployment.
param location = '<approved-azure-region>'
param namePrefix = '<approved-name-prefix>'
param storageAccountName = '<storage-name>'
param vaultName = '<vault-name>'
param captureImage = '<approved-public-image@sha256:digest>'
// Example digest only; replace with the SHA-256 returned by capture:private --stage.
param capturePlanDigest = '0000000000000000000000000000000000000000000000000000000000000000'
