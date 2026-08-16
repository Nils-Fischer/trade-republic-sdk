import type { AccountCash, AccountInfo, TickerResponse, TRQuery } from "../src/index.ts";
import { useGet, useWatch } from "../src/react.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

export type SuccessFlagNarrowsData = Assert<
  Equal<Extract<TRQuery<AccountCash>, { isSuccess: true }>["data"], AccountCash>
>;
export type SuccessStatusNarrowsData = Assert<
  Equal<Extract<TRQuery<AccountCash>, { status: "success" }>["data"], AccountCash>
>;
export type ErrorFlagRetainsOptionalData = Assert<
  Equal<Extract<TRQuery<AccountCash>, { isError: true }>["data"], AccountCash | undefined>
>;

const watchedTicker = useWatch("ticker", { id: "US88160R1014.LSX" });
const fetchedTicker = useGet("ticker", { id: "US88160R1014.LSX" });
const fetchedAccount = useGet("accountInfo");

export type WatchResponseIsInferred = Assert<Equal<typeof watchedTicker, TRQuery<TickerResponse>>>;
export type TopicGetResponseIsInferred = Assert<
  Equal<typeof fetchedTicker.data, TickerResponse | undefined>
>;
export type ResourceGetResponseIsInferred = Assert<
  Equal<typeof fetchedAccount.data, AccountInfo | undefined>
>;
export type WatchHasNoRefetch = Assert<
  Equal<"refetch" extends keyof typeof watchedTicker ? true : false, false>
>;
export type GetHasRefetch = Assert<
  Equal<"refetch" extends keyof typeof fetchedTicker ? true : false, true>
>;
