import { stdin, stdout } from "node:process";

export async function readCredentials(): Promise<{ phoneNumber: string; pin: string }> {
  const phoneNumber = process.env.TR_PHONE_NUMBER ?? (await readHidden("Phone number: "));
  const pin = process.env.TR_PIN ?? (await readHidden("PIN: "));
  if (!phoneNumber || !pin) throw new Error("missing-credentials");
  return { phoneNumber, pin };
}

function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) {
    return Promise.reject(new Error("interactive-terminal-required"));
  }

  stdout.write(prompt);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanUp = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanUp();
          reject(new Error("cancelled"));
          return;
        }
        if (byte === 10 || byte === 13) {
          cleanUp();
          resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) {
          value = value.slice(0, -1);
          continue;
        }
        value += Buffer.from([byte]).toString("utf8");
      }
    };
    stdin.on("data", onData);
  });
}
