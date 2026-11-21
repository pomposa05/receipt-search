// アプリ共通のエラー。code は画面側で案内文を切り替えるために使う。
export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
export const notFound = (msg = '指定された登録情報が見つかりません（削除された可能性があります）。') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (code, msg, details) => new AppError(409, code, msg, details);
