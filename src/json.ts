import { TRValidationError } from "./errors.ts";

interface JsonDecoder<Input, Output> {
  (value: Input): Output;
}

interface ResponseLike {
  text(): Promise<string>;
}

type JsonSource = string | Response | ResponseLike;

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
  source: Response | ResponseLike,
  decode: JsonDecoder<Input, Output>,
  options: Options,
): Promise<JsonResult<Output, Options>>;
export function parseJson<Input, Output>(
  source: JsonSource,
  decode: JsonDecoder<Input, Output>,
  options: JsonOptions,
): Output | undefined | Promise<Output | undefined> {
  if (source instanceof Response || isResponseLike(source)) {
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

function isResponseLike(source: JsonSource): source is ResponseLike {
  if (!(source instanceof Object) || source instanceof Response || !("text" in source))
    return false;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- React Native may provide a Response without the global Response brand.
  return typeof source.text === "function";
}
