import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getCurrentUser } from '../../../../lib/auth';
import {
  isVisitPhotoPathForSession,
  isValidVisitPhotoUploadSessionId,
  MAX_VISIT_PHOTO_BYTES,
} from '../../../../lib/visitPhotoUploadShared';
import { isSideEffectEnabled } from '../../../../lib/appEnvironment';

export const runtime = 'nodejs';

const getUploadSessionId = (clientPayload: string | null) => {
  if (!clientPayload) return null;

  try {
    const parsed = JSON.parse(clientPayload) as { sessionId?: unknown };
    return typeof parsed.sessionId === 'string' ? parsed.sessionId : null;
  } catch {
    return null;
  }
};

export async function POST(request: Request) {
  if (!isSideEffectEnabled('fileUploads')) {
    return Response.json({ error: 'File uploads are disabled in this environment.' }, { status: 503 });
  }
  let body: HandleUploadBody;

  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: 'Invalid upload request.' }, { status: 400 });
  }

  const user = body.type === 'blob.generate-client-token' ? await getCurrentUser() : null;
  if (body.type === 'blob.generate-client-token' && !user) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const sessionId = getUploadSessionId(clientPayload);
        if (!user || !sessionId || !isValidVisitPhotoUploadSessionId(sessionId)) {
          throw new Error('Invalid visit photo upload session.');
        }

        if (!isVisitPhotoPathForSession(pathname, sessionId)) {
          throw new Error('Invalid visit photo upload pathname.');
        }

        return {
          addRandomSuffix: false,
          allowedContentTypes: ['image/*'],
          maximumSizeInBytes: MAX_VISIT_PHOTO_BYTES,
          tokenPayload: JSON.stringify({ sessionId, userId: user.id }),
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
      onUploadCompleted: async () => undefined,
    });

    return Response.json(response);
  } catch (error) {
    console.error('Visit photo upload token request failed', {
      error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
      eventType: body.type,
      userId: user?.id ?? null,
    });
    return Response.json({ error: 'Unable to authorize the photo upload.' }, { status: 400 });
  }
}
