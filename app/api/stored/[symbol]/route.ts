import { candleQuery } from "../../../db";
import { createStoredApi } from "../../../storedApi";

export const dynamic = "force-dynamic";
export const GET = createStoredApi(candleQuery);
