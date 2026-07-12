export class AuthorizationError extends Error {
  readonly code = 'authorization_denied';

  constructor() {
    super('Permission denied.');
    this.name = 'AuthorizationError';
  }
}
