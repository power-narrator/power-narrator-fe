export type ErrorResult = {
  success: false;
  message: string;
};

export type SuccessResult<T extends object = object> = {
  success: true;
} & T;

export type Result<T extends object = object> = SuccessResult<T> | ErrorResult;
