import { TRValidationError } from "./errors.ts";

interface JsonDecoder<Input, Output> {
  (value: Input): Output;
}

interface ThrowInvalidJson {
  onInvalidJson: "throw";
  errorMessage: string;
}

interface IgnoreInvalidJson {
  onInvalidJson: "ignore";
}

type JsonOptions = ThrowInvalidJson | IgnoreInvalidJson;
type JsonResult<Output, Options extends JsonOptions> = Options extends ThrowInvalidJson
  ? Output
  : Output | undefined;

export function parseJson<Input, Output, Options extends JsonOptions>(
  source: string,
  decode: JsonDecoder<Input, Output>,
  options: Options,
): JsonResult<Output, Options>;
export function parseJson<Input, Output, Options extends JsonOptions>(
  source: Response,
  decode: JsonDecoder<Input, Output>,
  options: Options,
): Promise<JsonResult<Output, Options>>;
export function parseJson<Input, Output>(
  source: string | Response,
  decode: JsonDecoder<Input, Output>,
  options: JsonOptions,
): Output | undefined | Promise<Output | undefined> {
  if (source instanceof Response) {
    return source.text().then(
      (text) => parseJson(text, decode, options),
      (cause: unknown) => {
        if (options.onInvalidJson === "throw") {
          throw new TRValidationError(options.errorMessage, { cause });
        }
        return undefined;
      },
    );
  }

  let value: Input;
  try {
    value = JSON.parse(source);
  } catch (cause) {
    if (options.onInvalidJson === "throw") {
      throw new TRValidationError(options.errorMessage, { cause });
    }
    return undefined;
  }
  return decode(value);
}
