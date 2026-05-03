import { useMutation } from '@tanstack/react-query';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import {
  buildCriticalCommandHeaders,
  mintEnvelope,
} from './commandEnvelope';
import { getCachedDeviceIdSync } from './deviceId';
import { createTrpcClientWithHeaders } from './trpc';

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

type CriticalMutationProcedure = 'auth.changePassword';
type ChangePasswordInput = RouterInputs['auth']['changePassword'];
type ChangePasswordOutput = RouterOutputs['auth']['changePassword'];

type LocalServerCodeError = Error & {
  errorCode: 'DEVICE_NOT_REGISTERED';
};

function createMissingDeviceError(): LocalServerCodeError {
  const error = new Error(
    'Device registration is required before running this critical command.'
  ) as LocalServerCodeError;
  error.errorCode = 'DEVICE_NOT_REGISTERED';
  return error;
}

/**
 * ENG-052a bridge for the first critical web mutation.
 *
 * The full generic wrapper remains in ENG-052b, when the rest of
 * the ADR-0002 critical procedures move over. For this ticket we
 * only need `auth.changePassword`, but the call site already uses
 * the final shape: `useCriticalMutation('auth.changePassword')`.
 */
export function useCriticalMutation(procedure: CriticalMutationProcedure) {
  return useMutation<ChangePasswordOutput, Error, ChangePasswordInput>({
    mutationKey: ['criticalCommand', procedure],
    mutationFn: async input => {
      const deviceId = getCachedDeviceIdSync();
      if (!deviceId) {
        throw createMissingDeviceError();
      }

      const headers = buildCriticalCommandHeaders(deviceId, mintEnvelope());
      const client = createTrpcClientWithHeaders(headers);
      return client.auth.changePassword.mutate(input);
    },
  });
}
