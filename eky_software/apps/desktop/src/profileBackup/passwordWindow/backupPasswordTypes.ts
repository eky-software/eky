export type BackupPasswordWindowMode = 'create' | 'enter';

export type BackupPasswordSubmissionResult =
  | { accepted: true }
  | {
      accepted: false;
      errorCode: 'PASSWORD_INVALID' | 'PASSWORD_MISMATCH';
    };
