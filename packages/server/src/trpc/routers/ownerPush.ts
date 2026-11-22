import { TRPCError } from '@trpc/server';
import { getVapidPublicKey, hasWebPushKey } from '../../services/push/key-store.js';
import { assertOwnerPushEndpoint, dispatchOwnerPush } from '../../services/push/notify.js';
import {
  findPushSubscriptionLanguage,
  removePushSubscription,
  savePushSubscription,
} from '../../services/push/subscriptions.js';
import { isValidSubscriptionKeys } from '../../services/push/web-push.js';
import { router } from '../init.js';
import { createModuleGuard } from '../middleware/modules.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import {
  ownerPushStatusInput,
  ownerPushStatusOutput,
  ownerPushSubscribeInput,
  ownerPushSubscriptionOutput,
  ownerPushUnsubscribeInput,
} from '../schemas/ownerPush.js';

const ownerPushProcedure = managerOrAdminProcedure.use(createModuleGuard('companion'));

/** Opt-in web push for the owner's phone: approvals, handoffs and the sealed day. */
export const ownerPushRouter = router({
  status: ownerPushProcedure
    .input(ownerPushStatusInput)
    .output(ownerPushStatusOutput)
    .query(({ ctx, input }) => {
      const publicKey = getVapidPublicKey(ctx.db);
      const language =
        publicKey !== null && input.endpoint !== null
          ? findPushSubscriptionLanguage(ctx.db, {
              tenantId: ctx.tenantId,
              userId: ctx.user!.id,
              endpoint: input.endpoint,
            })
          : null;
      return { available: publicKey !== null, publicKey, subscribed: language !== null, language };
    }),

  subscribe: ownerPushProcedure
    .input(ownerPushSubscribeInput)
    .output(ownerPushSubscriptionOutput)
    .mutation(async ({ ctx, input }) => {
      if (!hasWebPushKey()) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Push is not available' });
      }
      if (!isValidSubscriptionKeys(input.keys)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid push subscription keys' });
      }
      try {
        await assertOwnerPushEndpoint(input.endpoint);
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid push endpoint' });
      }
      let added: boolean;
      try {
        added = savePushSubscription(ctx.db, {
          tenantId: ctx.tenantId,
          userId: ctx.user!.id,
          endpoint: input.endpoint,
          keys: input.keys,
          language: input.language,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'PUSH_ENDPOINT_TAKEN') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Push endpoint belongs to another browser',
          });
        }
        throw error;
      }
      if (added) {
        dispatchOwnerPush(ctx.db, {
          kind: 'enabled',
          tenantId: ctx.tenantId,
          userId: ctx.user!.id,
          endpoint: input.endpoint,
        });
      }
      return { subscribed: true };
    }),

  unsubscribe: ownerPushProcedure
    .input(ownerPushUnsubscribeInput)
    .output(ownerPushSubscriptionOutput)
    .mutation(({ ctx, input }) => {
      removePushSubscription(ctx.db, {
        tenantId: ctx.tenantId,
        userId: ctx.user!.id,
        endpoint: input.endpoint,
      });
      return { subscribed: false };
    }),
});

export type OwnerPushRouter = typeof ownerPushRouter;
