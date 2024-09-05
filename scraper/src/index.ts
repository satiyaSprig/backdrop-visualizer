import axios, { AxiosResponse } from "axios";
import promptsync from "prompt-sync";
import kfs from "key-file-storage";
import omit from "lodash/omit";
import groupBy from "lodash/groupBy";
import chunk from "lodash/chunk";
import sample from "lodash/sample";
import { gunzip } from "fflate";
import open from "open";
import KMeans from "@seregpie/k-means-plus-plus";
import { eventWithTime } from "rrweb";
import { EventType } from "rrweb";
import jsonDiff from "json-diff";
import fs from "fs";

let meansVector: {
  tag: string;
  class: string;
  style: string;
  src: string;
}[] = [];

interface Snapshot {
  tagName?: string;
  attributes?: {
    class?: string;
    style?: string;
    src?: string;
  };
  childNodes?: Snapshot[];
}

interface Backdrop {
  vector: number[];
  timestamp: number;
  node: Snapshot;
}

const shouldIgnoreTag = (tag: string) =>
  tag === "script" ||
  tag === "noscript" ||
  tag === "meta" ||
  tag === "iframe" ||
  tag === "head" ||
  tag === "html" ||
  tag === "style";

const addElementToVector = (
  vector: number[],
  tag: string,
  classes?: string,
  style?: string,
  src?: string
) => {
  const c = classes || "";
  const s = style || "";
  const sc = src || "";
  if (shouldIgnoreTag(tag)) return;
  let index = meansVector.findIndex(
    (v) => v.class === c && v.tag === tag && sc === v.src
  );
  if (index < 0) {
    index = meansVector.length;
    meansVector.push({
      tag,
      class: c,
      style: s,
      src: sc,
    });
  }
  padToLength(vector, meansVector.length);
  vector[index]++;
};

const padToLength = (vector: number[], length: number) => {
  while (vector.length < length) {
    vector.push(0);
  }
};

class PageVector {
  vector: number[] = [];
  constructor(snap: Snapshot) {
    padToLength(this.vector, meansVector.length);
    this.vectorize(snap);
  }

  private vectorize = (snap: Snapshot) => {
    if (snap.tagName) {
      addElementToVector(
        this.vector,
        snap.tagName,
        snap.attributes?.class,
        snap.attributes?.style,
        snap.attributes?.src
      );
    }
    if (snap.childNodes) {
      snap.childNodes.forEach((c) => this.vectorize(c));
    }
  };
}

const store = kfs("./storage", false);

const getHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

const getStoredToken = (name: string) => {
  return store.tokens?.[name];
};

const storeToken = (name: string, value: string) => {
  store.tokens = { ...store.tokens, [name]: value };
};

const clearToken = (name: string) => {
  store.tokens = { ...(store.tokens ? omit(store.tokens, "name") : {}) };
};

const DASHBOARD = "dashboard";

interface ReplayMeta {
  responseGroupUuid: string;
  id: string;
}

interface HeatmapEvent {
  timestamp: number;
  sessionReplayId: string;
}

interface ReplayWithEvents {
  replay?: ReplayMeta;
  events: HeatmapEvent[];
  url?: string;
  blob?: eventWithTime[];
  backdrops?: Backdrop[];
}

const getAllReplays = async (token: string, id: number) => {
  let cursor = undefined;
  let replays: ReplayMeta[] = [];
  do {
    console.log("query with replays cursor: ", cursor);
    const resp: AxiosResponse<{
      cursor: null | string;
      sessionReplays: ReplayMeta[];
    }> = await axios.post(
      `https://api.sprig.com/2/surveys/${id}/fetchSessionReplays?device=desktop`,
      {
        size: 200,
        sort: [
          {
            name: "CREATED_AT",
            order: "DESC",
          },
        ],
        cursor,
      },
      {
        headers: getHeaders(token),
      }
    );
    if (resp.status === 401) return false;
    replays = [...replays, ...resp.data.sessionReplays];
    cursor = resp.data.cursor;
  } while (cursor && replays.length < 5000);
  return replays;
};

const getHeatmapEvents = async (token: string, id: number) => {
  const resp: AxiosResponse<HeatmapEvent[]> = await axios.get(
    `https://api.sprig.com/2/surveys/${id}/heatmapEvents?type=Sprig_Click&device=desktop&captureLimit=5000`,
    {
      headers: getHeaders(token),
    }
  );
  return resp.data;
};

const getEventsByReplay = (replays: ReplayMeta[], events: HeatmapEvent[]) => {
  const groupedEvents = groupBy(events, (event) => event.sessionReplayId);
  return replays
    .filter((r) => r.id in groupedEvents)
    .map((r) => ({ replay: r, events: groupedEvents[r.id] }));
};

const findFullSnapshots = (blob: eventWithTime[]) => {
  return blob.filter((e) => e.type === EventType.FullSnapshot);
};
/*
const getDomSnapshots = (event: eventWithTimeAndPacker & { type: EventType.FullSnapshot }) => {
  event.data.
};*/

const processReplay = async (
  token: string,
  id: number,
  { replay, events }: ReplayWithEvents
) => {
  const sample = Math.random() < 0.5;
  try {
    if (!sample || !replay) return null;
    const [url, blob] = await getUnzippedBlob(token, id, replay);
    if (!blob) return null;
    return {
      url: url as string,
      blob: blob as eventWithTime[],
      events,
      id: replay.id,
    };
  } catch {
    return null;
  }
};

const getBackdrops = (blob: eventWithTime[]) => {
  const snaps = findFullSnapshots(blob as eventWithTime[]);
  return snaps.map((s) => ({
    timestamp: s.timestamp,
    vector: new PageVector(s.data.node as Snapshot).vector,
    node: s.data.node as Snapshot,
  }));
};

const getReplayUrl = async (token: string, id: number, replay: ReplayMeta) => {
  const resp: AxiosResponse<{ signedUrl: string }> = await axios.get(
    `https://api.sprig.com/2/surveys/${id}/getSessionReplayURL?responseGroupUuid=${replay.responseGroupUuid}`,
    {
      headers: getHeaders(token),
    }
  );
  return resp.data.signedUrl;
};

const getReplayBlob = async (url: string) => {
  const resp: AxiosResponse<Buffer> = await axios.get(url, {
    transformResponse: (r) => r,
    responseType: "arraybuffer",
  });
  return resp.data;
};

const unzipBlob = async (arrayBuffer: Buffer) => {
  try {
    // Try decompressing it
    return await new Promise((res, rej) => {
      gunzip(new Uint8Array(arrayBuffer), (err, result) => {
        if (err) {
          rej();
          return;
        }
        try {
          res(JSON.parse(new TextDecoder().decode(result)));
        } catch (e) {
          rej();
        }
      });
    });
  } catch (err) {
    return null;
  }
};

const getUnzippedBlob = async (
  token: string,
  id: number,
  replay: ReplayMeta
) => {
  const url = await getReplayUrl(token, id, replay);
  const blob = await getReplayBlob(url);
  return [url, await unzipBlob(blob)];
};

const processReplays = async (
  token: string,
  id: number,
  replays: ReplayWithEvents[]
) => {
  const chunked = chunk(replays, 20);
  const backdrops: (Backdrop & { url: string })[] = [];
  const processedReplays: ReplayWithEvents[] = [];
  console.log("Loading Replay Blobs...");
  await Promise.all(
    chunked.map(async (c) => {
      await Promise.all(
        c.map(async (r) => {
          const processed = await processReplay(token, id, r);
          if (processed) {
            processedReplays.push(processed);
          }
        })
      );
    })
  );
  console.log("Done Loading and Unzipping Replay Blobs");
  processedReplays.forEach((r) => {
    if (r.blob && r.url) {
      getBackdrops(r.blob).forEach((b) =>
        backdrops.push({ url: r.url as string, ...b })
      );
    }
  });

  backdrops.forEach((b) => {
    padToLength(b.vector, meansVector.length);
  });
  console.log(`Clustering ${backdrops.length} snapshots`);
  const results = KMeans(backdrops, 5, {
    map: (b) => b.vector,
  });
  console.log("Clustering finished.");
  const sampled = results.map((r) => sample(r));
  sampled.forEach((s, i) => {
    fs.writeFileSync(`./blobs/${i}.json`, JSON.stringify(s?.node));
  });
  const toSend = sampled.map((s) => ({ timestamp: s?.timestamp, url: s?.url }));
  console.log(sampled);
  open(
    `http://localhost:3000?replays=${encodeURIComponent(
      btoa(JSON.stringify(toSend))
    )}`
  );
};

const runWithToken = async (token: string) => {
  const id = Number(promptsync()("Survey ID:"));
  console.log("Loading Replays...");
  const replays = await getAllReplays(token, id);
  if (!replays) return false;
  console.log("Done Loading Replays");
  console.log("Loading Heatmap Events...");
  const events = await getHeatmapEvents(token, id);
  console.log("Done Loading Heatmap Events");
  const eventsByReplay = getEventsByReplay(replays, events);
  await processReplays(token, id, eventsByReplay);
  return true;
};

const run = async () => {
  let token = getStoredToken(DASHBOARD);
  if (!token) {
    const userToken = promptsync()("Paste dashboard bearer token:");
    storeToken(DASHBOARD, userToken);
    token = userToken;
  }
  const result = await runWithToken(token);
  if (!result) {
    clearToken(DASHBOARD);
    await run();
  }
};

run();
