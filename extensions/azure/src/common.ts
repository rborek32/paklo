import { logger } from '@paklo/core/logger';
import * as tl from 'azure-pipelines-task-lib/task';

/**
 * Masks the supplied values in the task log output.
 * https://learn.microsoft.com/en-us/azure/devops/pipelines/scripts/logging-commands?view=azure-devops&tabs=bash#setsecret-register-a-value-as-a-secret
 */
export function setSecrets(...args: (string | undefined)[]) {
  for (const arg of args.filter((a) => a && a?.toLowerCase() !== 'dependabot')) {
    if (!arg) continue;

    // Mask the value and the uri encoded value. This is required to ensure that API and package feed url don't expose the value.
    // e.g. "Contoso Ltd" would appear as "Contoso%20Ltd" unless the uri encoded value was set as a secret.
    tl.setSecret(arg);
    tl.setSecret(encodeURIComponent(arg));
  }
}

/**
 * Get the access token for Azure DevOps Repos.
 * Priority order:
 * 1. azureDevOpsAccessToken task input (INPUT_AZUREDEVOPSACCESSTOKEN env var)
 * 2. azureDevOpsEntraServiceConnection task input (Entra workload identity, PAT-less)
 * 3. azureDevOpsServiceConnection task input (ExternalTFS PAT)
 * 4. SystemVssConnection endpoint auth (agent-populated for task steps, or via
 *    ENDPOINT_AUTH_PARAMETER_SYSTEMVSSCONNECTION_ACCESSTOKEN env var for script steps)
 * 5. SYSTEM_ACCESSTOKEN env var (pipeline OAuth token — not processed by vault,
 *    so it survives in process.env; requires SYSTEM_ACCESSTOKEN: $(System.AccessToken)
 *    in the script step's env section)
 */
export function getAzureDevOpsAccessToken() {
  const systemAccessToken = tl.getInput('azureDevOpsAccessToken');
  if (systemAccessToken) {
    tl.debug('azureDevOpsAccessToken provided, using for authenticating');
    return systemAccessToken;
  }

  // Path 2: Azure DevOps (Entra workload identity) service connection.
  // connectedService:AzureDevOps uses scheme 'WorkloadIdentityFederation' or 'OAuth';
  // the bearer token is in 'AccessToken' or 'accesstoken'. Log the scheme on first use
  // so any future breakage from Microsoft's (Preview) API is immediately diagnosable.
  const entraConnectionName = tl.getInput('azureDevOpsEntraServiceConnection');
  if (entraConnectionName) {
    tl.debug('Azure DevOps (Entra) connection supplied.');
    const auth = tl.getEndpointAuthorization(entraConnectionName, true);
    if (auth) {
      tl.debug(`Entra connection auth scheme: ${auth.scheme}`);
      const token =
        auth.parameters['AccessToken'] || auth.parameters['accesstoken'] || auth.parameters['apitoken'];
      if (token) return token;
    }
    // Script steps: agent strips ENDPOINT_AUTH_* env vars; fall back to explicit env var.
    const envToken = process.env['AZDO_SERVICE_CONNECTION_APITOKEN'];
    if (envToken) {
      tl.debug('Using AZDO_SERVICE_CONNECTION_APITOKEN env var (Entra script-step fallback).');
      return envToken;
    }
    throw new Error(`Cannot obtain a token for Entra service connection '${entraConnectionName}'.`);
  }

  const serviceConnectionName = tl.getInput('azureDevOpsServiceConnection');
  if (serviceConnectionName) {
    tl.debug('TFS connection supplied. A token shall be extracted from it.');
    // Task steps: agent pre-populates the vault for authorized service connections.
    const vaultToken = tl.getEndpointAuthorizationParameter(serviceConnectionName, 'apitoken', true);
    if (vaultToken) return vaultToken;
    // Script steps: the agent strips ENDPOINT_AUTH_* env vars as a security measure,
    // so the vault is empty. Fall back to an explicit env var that the user can set.
    const scriptStepToken = process.env['AZDO_SERVICE_CONNECTION_APITOKEN'];
    if (scriptStepToken) {
      tl.debug('Using AZDO_SERVICE_CONNECTION_APITOKEN env var as script-step service connection fallback.');
      return scriptStepToken;
    }
    throw new Error(
      `Cannot obtain a token for service connection '${serviceConnectionName}'. ` +
        `For task steps, ensure the connection is authorized in pipeline settings. ` +
        `For script steps, set AZDO_SERVICE_CONNECTION_APITOKEN in the step env block.`,
    );
  }

  // optional=true so the call returns undefined instead of throwing when
  // running as a script step where the agent does not populate ENDPOINT_AUTH_* vars.
  const sysVssToken = tl.getEndpointAuthorizationParameter('SystemVssConnection', 'AccessToken', true);
  if (sysVssToken) {
    tl.debug("Using SystemVssConnection's AccessToken.");
    return sysVssToken;
  }

  // The task-lib vault processes and removes INPUT_* / ENDPOINT_AUTH_* from process.env,
  // but leaves SYSTEM_ACCESSTOKEN untouched. Use it as a last-resort fallback for
  // script-step invocations where the PAT variable group may not expand.
  const oauthToken = process.env['SYSTEM_ACCESSTOKEN'];
  if (oauthToken) {
    tl.debug('Using pipeline OAuth token (SYSTEM_ACCESSTOKEN) as access token fallback.');
    return oauthToken;
  }

  throw new Error(
    'No Azure DevOps access token could be obtained. ' +
      'Provide the azureDevOpsAccessToken input, azureDevOpsServiceConnection, ' +
      'or pass SYSTEM_ACCESSTOKEN: $(System.AccessToken) in the script step env.',
  );
    // Task steps: agent pre-populates the vault for authorized service connections.
    const vaultToken = tl.getEndpointAuthorizationParameter(serviceConnectionName, 'apitoken', true);
    if (vaultToken) return vaultToken;
    // Script steps: the agent strips ENDPOINT_AUTH_* env vars as a security measure,
    // so the vault is empty. Fall back to an explicit env var that the user can set.
    const scriptStepToken = process.env['AZDO_SERVICE_CONNECTION_APITOKEN'];
    if (scriptStepToken) {
      tl.debug('Using AZDO_SERVICE_CONNECTION_APITOKEN env var as script-step service connection fallback.');
      return scriptStepToken;
    }
    throw new Error(
      `Cannot obtain a token for service connection '${serviceConnectionName}'. ` +
        `For task steps, ensure the connection is authorized in pipeline settings. ` +
        `For script steps, set AZDO_SERVICE_CONNECTION_APITOKEN in the step env block.`,
    );
  }

  // optional=true so the call returns undefined instead of throwing when
  // running as a script step where the agent does not populate ENDPOINT_AUTH_* vars.
  const sysVssToken = tl.getEndpointAuthorizationParameter('SystemVssConnection', 'AccessToken', true);
  if (sysVssToken) {
    tl.debug("Using SystemVssConnection's AccessToken.");
    return sysVssToken;
  }

  // The task-lib vault processes and removes INPUT_* / ENDPOINT_AUTH_* from process.env,
  // but leaves SYSTEM_ACCESSTOKEN untouched. Use it as a last-resort fallback for
  // script-step invocations where the PAT variable group may not expand.
  const oauthToken = process.env['SYSTEM_ACCESSTOKEN'];
  if (oauthToken) {
    tl.debug('Using pipeline OAuth token (SYSTEM_ACCESSTOKEN) as access token fallback.');
    return oauthToken;
  }

  throw new Error(
    'No Azure DevOps access token could be obtained. ' +
      'Provide the azureDevOpsAccessToken input, azureDevOpsServiceConnection, ' +
      'or pass SYSTEM_ACCESSTOKEN: $(System.AccessToken) in the script step env.',
  );
}

/**
 * Configures the logger to route logs through Azure DevOps task output,
 * and sets the log level based on the debug input.
 */
export function setupLogging({ debug }: { debug: boolean }) {
  // Route core logs through Azure DevOps task output.
  logger.replace({
    log: ({ level, message }) => {
      switch (level) {
        case 'fatal':
        case 'error':
          tl.error(message);
          break;
        case 'warn':
          tl.warning(message);
          break;
        case 'debug':
        case 'trace':
          tl.debug(message);
          break;
        case 'info':
        default:
          console.log(message);
          break;
      }
    },

    /**
     * Formats the logs into groups and sections to allow for easier navigation and readability.
     * https://learn.microsoft.com/en-us/azure/devops/pipelines/scripts/logging-commands?view=azure-devops&tabs=bash#formatting-commands
     */

    startGroup: (name) => console.log(`##[group]${name}`),
    endGroup: () => console.log(`##[endgroup]`),
    section: (name) => console.log(`##[section]${name}`),
  });

  // update logger level based on debug input
  logger.level = debug ? 'debug' : 'info';
}
