targetScope = 'resourceGroup'

@description('Azure region approved for private capture.')
param location string = resourceGroup().location

@description('Globally unique storage account name, 3-24 lowercase letters and digits.')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Globally unique Key Vault name.')
@minLength(3)
@maxLength(24)
param vaultName string

@description('Prefix for resource names within the resource group.')
@minLength(2)
@maxLength(30)
param namePrefix string

@description('Approved publicly pullable capture image, pinned by digest. Build source is in this directory; no image is automatically published.')
param captureImage string

@description('SHA-256 of the explicitly approved private plan staged in Blob storage.')
@minLength(64)
@maxLength(64)
param capturePlanDigest string

@description('Opt in to paid Log Analytics ingestion. Private evidence and bounded driver diagnostics remain in Blob either way.')
param enableLogAnalytics bool = false

var containerName = 'capture-private'
var blobDataContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var keyVaultSecretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-identity'
  location: location
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      days: 30
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 30
    }
  }
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    accessPolicies: []
  }
}

resource storageAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: container
  name: guid(container.id, identity.id, blobDataContributorRole)
  properties: {
    roleDefinitionId: blobDataContributorRole
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource vaultAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, identity.id, keyVaultSecretsUserRole)
  properties: {
    roleDefinitionId: keyVaultSecretsUserRole
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (enableLogAnalytics) {
  name: '${namePrefix}-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: '${namePrefix}-env'
  location: location
  properties: {
    appLogsConfiguration: enableLogAnalytics ? {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs!.properties.customerId
        sharedKey: logs!.listKeys().primarySharedKey
      }
    } : {
      destination: 'none'
    }
  }
}

resource job 'Microsoft.App/jobs@2025-01-01' = {
  name: '${namePrefix}-job'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 3600
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
    }
    template: {
      containers: [
        {
          name: 'capture'
          image: captureImage
          resources: {
            cpu: json('2.0')
            memory: '4Gi'
          }
          env: [
            {
              name: 'AZURE_CLIENT_ID'
              value: identity.properties.clientId
            }
            {
              name: 'CAPTURE_BLOB_SERVICE_URL'
              value: storage.properties.primaryEndpoints.blob
            }
            {
              name: 'CAPTURE_BLOB_CONTAINER'
              value: container.name
            }
            {
              name: 'CAPTURE_PLAN_DIGEST'
              value: capturePlanDigest
            }
            {
              name: 'CAPTURE_KEY_VAULT_URI'
              value: vault.properties.vaultUri
            }
          ]
        }
      ]
    }
  }
}

output jobName string = job.name
output blobContainerName string = container.name
output managedIdentityClientId string = identity.properties.clientId
output keyVaultUri string = vault.properties.vaultUri
