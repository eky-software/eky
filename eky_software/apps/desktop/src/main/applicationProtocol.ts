import { readFile } from 'node:fs/promises';

import { net, protocol } from 'electron';

import {
  createBackendRequestHeaders,
  createBackendResponseHeaders,
  getStaticContentType,
  isAllowedBackendRequest,
  maximumBackendRequestBodyBytes,
  resolveStaticResourcePath,
} from './protocolPolicy.js';
import {
  readSmtpTestPreparationConfirmation,
  type SmtpTestPreparationConfirmation,
} from './smtpTestConfirmation.js';

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export interface RegisterApplicationProtocolOptions {
  backendOrigin: string;
  confirmSmtpTestPreparation?(
    preparation: SmtpTestPreparationConfirmation,
  ): Promise<boolean>;
  runtimeSessionSecret: string;
  webRoot: string;
}

function jsonError(status: number, message: string): Response {
  return Response.json({ message }, { status });
}

async function proxyBackendRequest(
  request: Request,
  runtimeSessionSecret: string,
  targetUrl: URL,
  confirmSmtpTestPreparation?: (
    preparation: SmtpTestPreparationConfirmation,
  ) => Promise<boolean>,
): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');

  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > maximumBackendRequestBodyBytes
  ) {
    return jsonError(413, 'Pyyntö on liian suuri.');
  }

  const requestOptions: RequestInit = {
    headers: createBackendRequestHeaders(
      request.headers,
      runtimeSessionSecret,
    ),
    method: request.method,
  };

  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    const body = await request.arrayBuffer();

    if (body.byteLength > maximumBackendRequestBodyBytes) {
      return jsonError(413, 'Pyyntö on liian suuri.');
    }

    if (body.byteLength > 0) {
      requestOptions.body = body;
    }
  }

  try {
    const backendResponse = await net.fetch(targetUrl.toString(), requestOptions);

    if (
      backendResponse.ok &&
      targetUrl.pathname.endsWith('/email/smtp-test/prepare') &&
      confirmSmtpTestPreparation !== undefined
    ) {
      let responseBody: unknown;

      try {
        responseBody = await backendResponse.clone().json();
      } catch {
        return jsonError(502, 'SMTP-testin valmistelua ei voitu vahvistaa.');
      }

      const confirmation = readSmtpTestPreparationConfirmation(responseBody);

      if (confirmation === undefined) {
        return jsonError(502, 'SMTP-testin valmistelua ei voitu vahvistaa.');
      }

      if (!(await confirmSmtpTestPreparation(confirmation))) {
        return jsonError(409, 'SMTP-testilähetys peruutettiin.');
      }
    }

    return new Response(backendResponse.body, {
      headers: createBackendResponseHeaders(backendResponse.headers),
      status: backendResponse.status,
      statusText: backendResponse.statusText,
    });
  } catch {
    return jsonError(502, 'Paikallinen palvelu ei vastaa.');
  }
}

async function serveStaticResource(
  webRoot: string,
  pathname: string,
): Promise<Response> {
  const resourcePath = resolveStaticResourcePath(webRoot, pathname);

  if (resourcePath === undefined) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const content = await readFile(resourcePath);

    return new Response(new Uint8Array(content), {
      headers: {
        'cache-control': pathname === '/index.html' ? 'no-store' : 'public, max-age=31536000',
        'content-security-policy': contentSecurityPolicy,
        'content-type': getStaticContentType(resourcePath),
        'cross-origin-opener-policy': 'same-origin',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
      },
      status: 200,
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

export function registerApplicationProtocol(
  options: RegisterApplicationProtocolOptions,
): void {
  protocol.handle('eky', async (request) => {
    const requestUrl = new URL(request.url);

    if (requestUrl.hostname !== 'app') {
      return new Response('Not found', { status: 404 });
    }

    if (isAllowedBackendRequest(request.method, requestUrl.pathname)) {
      const targetUrl = new URL(
        `${requestUrl.pathname}${requestUrl.search}`,
        options.backendOrigin,
      );

      return proxyBackendRequest(
        request,
        options.runtimeSessionSecret,
        targetUrl,
        options.confirmSmtpTestPreparation,
      );
    }

    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    return serveStaticResource(options.webRoot, requestUrl.pathname);
  });
}
