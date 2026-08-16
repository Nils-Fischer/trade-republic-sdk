import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  errorQuery,
  pendingQuery,
  successQuery,
  type AccountCash,
  type AccountDocument,
  type AccountQuery,
  type AccountSlice,
  type Transaction,
  type TransactionQuery,
  type TransactionSlice,
  type TRAccount,
  type TRQuery,
} from "./account.ts";
import type { TRClient } from "./client.ts";
import type { ConnectionSnapshot } from "./connection.ts";
import { TRAbortError, TRValidationError } from "./errors.ts";
import { RequestMultiplexer, type GetQueryStore } from "./react-multiplexer.ts";
import type { ResourceName, ResourceResponse } from "./resources.ts";
import type { SessionSnapshot } from "./session.ts";
import type { TopicName, TopicRequest, TopicResponse } from "./topics.ts";

interface TRContextValue {
  readonly client: TRClient;
  readonly account: TRAccount | undefined;
  readonly requests: RequestMultiplexer;
}

export interface TRProviderProps {
  readonly client: TRClient;
  readonly account?: TRAccount;
  readonly autoSync?: boolean;
  readonly children: ReactNode;
}

export interface LoginAction {
  login(phoneNumber: string, pin: string): Promise<void>;
  abort(): void;
  readonly status: "idle" | "pending" | "awaiting-approval" | "failed";
  readonly error: Error | undefined;
}

export interface SyncAction {
  sync(): Promise<void>;
  readonly status: "idle" | "pending" | "failed";
  readonly error: Error | undefined;
}

interface LoginState {
  readonly status: LoginAction["status"];
  readonly error: Error | undefined;
}

interface SyncState {
  readonly status: SyncAction["status"];
  readonly error: Error | undefined;
}

interface RangeState {
  readonly from: number;
  readonly to: number | undefined;
  readonly query: TRQuery<readonly Transaction[]>;
}

const TRContext = createContext<TRContextValue | undefined>(undefined);
const idleLoginState: LoginState = Object.freeze({ status: "idle", error: undefined });
const idleSyncState: SyncState = Object.freeze({ status: "idle", error: undefined });
const pendingTransactionRangeQuery = pendingQuery<readonly Transaction[]>();

/** Make constructed SDK instances available to React hooks. */
export function TRProvider({
  client,
  account,
  autoSync = false,
  children,
}: TRProviderProps): ReactElement {
  const requests = useMemo(() => new RequestMultiplexer(client), [client]);
  const value = useMemo<TRContextValue>(
    () => Object.freeze({ client, account, requests }),
    [client, account, requests],
  );

  useEffect(() => {
    if (!autoSync || !account) return;
    void account.sync().catch(() => undefined);
  }, [account, autoSync]);

  return createElement(TRContext.Provider, { value }, children);
}

/** Return the client owned by the nearest provider. */
export function useTRClient(): TRClient {
  return useTRContext("useTRClient").client;
}

/** Return the account owned by the nearest provider. */
export function useTRAccount(): TRAccount {
  return useAccount("useTRAccount");
}

/** Subscribe to any account Slice. */
export function useAccountSlice(slice: TransactionSlice): TransactionQuery;
export function useAccountSlice<Value>(slice: AccountSlice<Value>): AccountQuery<Value>;
export function useAccountSlice<Value>(slice: AccountSlice<Value>): AccountQuery<Value> {
  useTRContext("useAccountSlice");
  return useExternalStore(slice);
}

export function useCash(): AccountQuery<AccountCash> {
  const account = useAccount("useCash");
  return useAccountSlice(account.cash);
}

export function useTransactions(): TransactionQuery {
  const account = useAccount("useTransactions");
  return useAccountSlice(account.transactions);
}

export function useDocuments(): AccountQuery<readonly AccountDocument[]> {
  const account = useAccount("useDocuments");
  return useAccountSlice(account.documents);
}

export function useSession(): SessionSnapshot {
  const client = useTRContext("useSession").client;
  return useExternalStore(client.session);
}

export function useConnection(): ConnectionSnapshot {
  const client = useTRContext("useConnection").client;
  return useExternalStore(client.connection);
}

/** Subscribe to a live Topic shared by equal requests in this provider. */
export function useWatch<Name extends TopicName>(
  name: Name,
  request: TopicRequest<Name>,
): TRQuery<TopicResponse<Name>> {
  const requests = useTRContext("useWatch").requests;
  return useExternalStore(requests.watch(name, request));
}

/** Read a Topic once and expose an explicit refresh action. */
export function useGet<Name extends TopicName>(
  name: Name,
  request: TopicRequest<Name>,
): TRQuery<TopicResponse<Name>> & { readonly refetch: () => void };
/** Read an HTTP Resource once and expose an explicit refresh action. */
export function useGet<Name extends ResourceName>(
  name: Name,
): TRQuery<ResourceResponse<Name>> & { readonly refetch: () => void };
export function useGet(
  name: TopicName | ResourceName,
  request?: TopicRequest<TopicName>,
): TRQuery<TopicResponse<TopicName> | ResourceResponse<ResourceName>> & {
  readonly refetch: () => void;
} {
  const requests = useTRContext("useGet").requests;
  let store: GetQueryStore<TopicResponse<TopicName> | ResourceResponse<ResourceName>>;
  if (request === undefined) {
    // SAFETY: The public overload without a request accepts Resource names only.
    const resourceName = name as ResourceName;
    store = requests.getResource(resourceName);
  } else {
    // SAFETY: The public overload with a request accepts Topic names only.
    const topicName = name as TopicName;
    store = requests.getTopic(topicName, request);
  }
  return useGetStore(store);
}

/** Start and cancel the interactive login flow. */
export function useLogin(): LoginAction {
  const client = useTRContext("useLogin").client;
  const [state, setState] = useState<LoginState>(idleLoginState);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const operationRef = useRef<Promise<void> | undefined>(undefined);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort("useLogin unmounted");
    };
  }, [client]);

  const login = useCallback(
    (phoneNumber: string, pin: string): Promise<void> => {
      if (operationRef.current) {
        return Promise.reject(new TRValidationError("useLogin already has a Login in progress"));
      }

      const controller = new AbortController();
      controllerRef.current = controller;
      setState(Object.freeze({ status: "pending", error: undefined }));

      const operation = client.login(phoneNumber, pin, {
        signal: controller.signal,
        onApprovalPending: () => {
          if (mountedRef.current && controllerRef.current === controller) {
            setState(Object.freeze({ status: "awaiting-approval", error: undefined }));
          }
        },
      });
      const result = operation.then(
        () => {
          if (mountedRef.current && controllerRef.current === controller) {
            setState(idleLoginState);
          }
        },
        (cause: unknown) => {
          if (controller.signal.aborted || cause instanceof TRAbortError) {
            if (mountedRef.current && controllerRef.current === controller) {
              setState(idleLoginState);
            }
            return;
          }
          const error = actionError(cause, "Login failed");
          if (mountedRef.current && controllerRef.current === controller) {
            setState(Object.freeze({ status: "failed", error }));
          }
          throw error;
        },
      );
      operationRef.current = result;
      void result.then(
        () => clearLoginOperation(operationRef, controllerRef, result, controller),
        () => clearLoginOperation(operationRef, controllerRef, result, controller),
      );
      return result;
    },
    [client],
  );

  const abort = useCallback(() => controllerRef.current?.abort("useLogin aborted"), []);
  return useMemo(
    () => Object.freeze({ login, abort, status: state.status, error: state.error }),
    [abort, login, state],
  );
}

/** Run account maintenance and report its fetching state. */
export function useSync(): SyncAction {
  const account = useAccount("useSync");
  const [state, setState] = useState<SyncState>(idleSyncState);
  const operationRef = useRef<Promise<void> | undefined>(undefined);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const sync = useCallback((): Promise<void> => {
    if (operationRef.current) return operationRef.current;
    setState(Object.freeze({ status: "pending", error: undefined }));
    const operation = account.sync();
    operationRef.current = operation;
    void operation.then(
      () => {
        if (operationRef.current === operation) operationRef.current = undefined;
        if (mountedRef.current) setState(idleSyncState);
      },
      (cause: unknown) => {
        if (operationRef.current === operation) operationRef.current = undefined;
        if (mountedRef.current) {
          setState(
            Object.freeze({ status: "failed", error: actionError(cause, "Account Sync failed") }),
          );
        }
      },
    );
    return operation;
  }, [account]);

  return useMemo(
    () => Object.freeze({ sync, status: state.status, error: state.error }),
    [state, sync],
  );
}

/** Read transactions for one bounded point-in-time range. */
export function useTransactionRange(range: {
  readonly from: Date;
  readonly to?: Date;
}): TRQuery<readonly Transaction[]> {
  const account = useAccount("useTransactionRange");
  const from = range.from.getTime();
  const to = range.to?.getTime();
  const [state, setState] = useState<RangeState>(() => ({
    from,
    to,
    query: pendingTransactionRangeQuery,
  }));

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState((current) => {
      if (sameRange(current, from, to) && current.query.isPending) return current;
      return { from, to, query: pendingTransactionRangeQuery };
    });
    const operation =
      to === undefined
        ? account.transactions.read({ from: new Date(from), signal: controller.signal })
        : account.transactions.read({
            from: new Date(from),
            to: new Date(to),
            signal: controller.signal,
          });
    void operation.then(
      (data) => {
        if (active) setState({ from, to, query: successQuery(data) });
      },
      (cause: unknown) => {
        if (!active || controller.signal.aborted || cause instanceof TRAbortError) return;
        setState({ from, to, query: errorQuery(actionError(cause, "Transaction read failed")) });
      },
    );
    return () => {
      active = false;
      controller.abort("useTransactionRange changed or unmounted");
    };
  }, [account, from, to]);

  return sameRange(state, from, to) ? state.query : pendingTransactionRangeQuery;
}

function useTRContext(hookName: string): TRContextValue {
  const value = useContext(TRContext);
  if (!value) throw new TRValidationError(`${hookName} must be used within a TRProvider`);
  return value;
}

function useAccount(hookName: string): TRAccount {
  const account = useTRContext(hookName).account;
  if (!account) {
    throw new TRValidationError(`${hookName} requires TRProvider to receive an account`);
  }
  return account;
}

function useExternalStore<Snapshot>(store: {
  getSnapshot(): Snapshot;
  subscribe(onChange: () => void): () => void;
}): Snapshot {
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useGetStore<Value>(
  store: GetQueryStore<Value>,
): TRQuery<Value> & { readonly refetch: () => void } {
  const query = useExternalStore(store);
  return useMemo(() => Object.freeze({ ...query, refetch: () => store.refetch() }), [query, store]);
}

function clearLoginOperation(
  operationRef: { current: Promise<void> | undefined },
  controllerRef: { current: AbortController | undefined },
  operation: Promise<void>,
  controller: AbortController,
): void {
  if (operationRef.current === operation) operationRef.current = undefined;
  if (controllerRef.current === controller) controllerRef.current = undefined;
}

function actionError(cause: unknown, message: string): Error {
  return cause instanceof Error ? cause : new Error(message, { cause });
}

function sameRange(state: RangeState, from: number, to: number | undefined): boolean {
  return Object.is(state.from, from) && Object.is(state.to, to);
}
