/** authenticated binary delivery for immutable day-close PDFs. */
import type { FastifyInstance } from 'fastify';
import { MANAGER_OR_ADMIN_ROLES } from '@puntovivo/shared/roles';
import { verifyAccessToken } from '../../security/authTokens.js';
import { getDayClosePdfArtifact } from '../../services/reports/day-close-signoff.js';

const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function errorBody(errorCode: string, message: string) {
  return { error: { errorCode, message } };
}

export async function registerDayCloseArtifactRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { artifactId: string } }>(
    '/api/reports/day-close/artifacts/:artifactId',
    async (request, reply) => {
      const payload = await verifyAccessToken(request);
      if (!payload) {
        return reply
          .code(401)
          .send(errorBody('AUTH_UNAUTHORIZED', 'A valid access token is required'));
      }
      if (!MANAGER_OR_ADMIN_ROLES.some(role => role === payload.role)) {
        return reply
          .code(403)
          .send(errorBody('AUTH_FORBIDDEN', 'Manager or administrator access is required'));
      }
      if (!ARTIFACT_ID_PATTERN.test(request.params.artifactId)) {
        return reply
          .code(400)
          .send(errorBody('DAY_CLOSE_ARTIFACT_ID_INVALID', 'The artifact identifier is invalid'));
      }

      try {
        const artifact = getDayClosePdfArtifact(
          app.db,
          payload.tenantId,
          request.params.artifactId
        );
        if (!artifact) {
          return reply
            .code(404)
            .send(errorBody('DAY_CLOSE_ARTIFACT_NOT_FOUND', 'The PDF artifact was not found'));
        }

        return reply
          .header('cache-control', 'private, no-store, max-age=0')
          .header('content-disposition', `attachment; filename="${artifact.metadata.filename}"`)
          .header('content-length', String(artifact.metadata.byteSize))
          .type(artifact.metadata.mimeType)
          .send(artifact.payload);
      } catch (error) {
        request.log.error({ err: error }, 'Day-close PDF integrity verification failed');
        return reply
          .code(500)
          .send(
            errorBody(
              'DAY_CLOSE_ARTIFACT_INTEGRITY_FAILED',
              'The stored PDF failed integrity verification'
            )
          );
      }
    }
  );
}
