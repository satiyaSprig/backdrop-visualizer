import styled from "@emotion/styled";
import axios, { AxiosResponse } from "axios";
import { gunzip } from "fflate";
import React, { useEffect, useState } from "react";
import { Replayer } from "rrweb";
import { eventWithTimeAndPacker } from 'rrweb/typings/packer/base';

interface Props {
  id: string;
  timestamp: number;
  url: string;
}

type Replay = Array<eventWithTimeAndPacker>;

export const nodeIsElement = (node: Node | Element | null): node is HTMLElement => {
  return typeof node === 'object' && node !== null && node.nodeType === Node.ELEMENT_NODE;
};

const ignoreElementHeight = (element: HTMLElement, contentWindow: Window) => {
  const computedStyles = contentWindow.getComputedStyle(element);
  return (
    computedStyles.getPropertyValue('position') === 'fixed' || computedStyles.getPropertyValue('overflow') === 'hidden'
  );
};

export const createGetMaxScrollDepth = () => {
  let maxScrollDepth = 0;

  const getMaxScrollDepth = (nodesList?: HTMLCollection, contentWindow?: Window | null) => {
    if (!nodesList || !contentWindow) {
      return maxScrollDepth;
    }

    Array.from(nodesList).forEach((node: Element) => {
      if (!node || !nodeIsElement(node) || ignoreElementHeight(node, contentWindow)) {
        return;
      }

      if (node.scrollHeight && node.clientHeight) {
        const top = node.offsetTop;
        const height = node.offsetHeight;
        const elementHeight = Math.max(node.scrollHeight + top, node.clientHeight + top, height + top);
        maxScrollDepth = Math.max(elementHeight, maxScrollDepth);
      }
      if (node.childNodes.length) {
        getMaxScrollDepth(node.children, contentWindow);
      }
    });
    return maxScrollDepth;
  };

  return getMaxScrollDepth;
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

const useReplayData = (url: string) => {
  const [replay, setReplay] = useState<Replay | null>(null);

  const fetchReplay = async () => {
    const blob = await getReplayBlob(url);
    if (!blob) return null;
    setReplay(await unzipBlob(blob) as any);
  };

  useEffect(() => {
    fetchReplay();
  }, []);
  return replay;
};

export const isDimensions = (dim: unknown): dim is { width: number; height: number } => {
  return typeof dim === 'object' && dim !== null && 'width' in dim && 'height' in dim;
};




export const ReplayView = ({ id, timestamp, url }: Props) => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [replayer, setReplayer] =  useState<Replayer | null>(null);
  const replay = useReplayData(url);
  const [forceHeight, setForceHeight] = useState(0);



  const scaleReplayerToFitContainer = (r: Replayer, iframeSize: { width: number; height: number }) => {
    const parent = container;
    if (!r.wrapper || !parent) return;
    const { width: containerWidth, height: containerHeight } = parent.getBoundingClientRect();
    const { width: replayWidth, height: replayHeight } = iframeSize;
    let scaleAmtX = Math.min(containerWidth / replayWidth, containerHeight / replayHeight);
    if (isNaN(scaleAmtX)) {
      scaleAmtX = 1;
    }
    const scaleAmtY = scaleAmtX;
  
    const depth = createGetMaxScrollDepth()(
      r?.iframe?.contentDocument?.documentElement?.children,
      r?.iframe?.contentWindow);
    r.wrapper.style.transform = `scale(${scaleAmtX}, ${scaleAmtY})`;
    r.iframe.height = `${depth}px`;
    const newSize = r.wrapper.getBoundingClientRect();
    setForceHeight(newSize.height);
  };

  useEffect(() => {
    if (!container || !replay) return;
    const r = new Replayer(replay, {
      root: container,
      speed: 0,
      useVirtualDom: false,
      mouseTail: false,
      triggerFocus: false,
    });

    r.on('resize', (dimensions) => {
      if (isDimensions(dimensions)) {
        return scaleReplayerToFitContainer(r, dimensions);
      }
    });
    r.on('fullsnapshot-rebuilded', () => {
      setTimeout(() => {
        scaleReplayerToFitContainer(r, { width: r.iframe.offsetWidth, height: r.iframe.offsetHeight });
      }, 200);
    });
    const startTime = replay?.[0]?.timestamp || 0;
    r?.pause?.((timestamp - startTime) / 1000);
    setReplayer(r);
    return () => {
      r.destroy();
    };
  }, [container, replay]);


  useEffect(() => {
    if (replayer && container) {
      scaleReplayerToFitContainer(replayer, { width: replayer.iframe.offsetWidth, height: replayer.iframe.offsetHeight });
    }
  }, [replayer, container]);

  return (
    <Wrapper style={forceHeight ? { maxHeight: forceHeight } : {}}>
      <Container ref={setContainer}></Container>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  overflow: hidden;
  width: fit-content;
`;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  position: relative;

  & iframe {
    border: none;
    transform-origin: top center;
  }

  & .replayer-wrapper {
    transform-origin: top center;
  }

  & .replayer-mouse {
    display: none;
  }
  max-width: 600px;
`;
