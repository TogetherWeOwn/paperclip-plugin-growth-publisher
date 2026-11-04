import { FileStore } from "../src/storage.ts";

const [filename, companyId, expected, contender] = process.argv.slice(2);
if (!filename || !companyId || !expected || !contender || !process.send) throw new Error("Missing race worker arguments / IPC");
const store = new FileStore<{ contender: string }>(filename);
try {
  const loaded = await store.load(companyId);
  const version = expected === "null" ? null : Number(expected);
  if ((loaded?.version ?? null) !== version) throw new Error("Unexpected race starting version");
  const go = new Promise<void>((resolve, reject) => {
    process.once("message", (message) => message === "go" ? resolve() : reject(new Error("Unexpected race signal")));
  });
  process.send({ ready: true });
  await go;
  const won = await store.compareAndSwap(companyId, version, { contender });
  process.send({ won });
} finally {
  store.close();
  process.disconnect();
}
