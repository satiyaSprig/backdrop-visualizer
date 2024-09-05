import React, { useEffect, useState } from "react";
import logo from "./logo.svg";
import "./App.css";
import { useSearchParams } from "react-router-dom";
import styled from "@emotion/styled";
import { ReplayView } from "./ReplayView";

interface Replay {
  id: string;
  timestamp: number;
  url: string;
}

export const ReplayVis = () => {
  const [searchParams] = useSearchParams();
  const [replays, setReplays] = useState<Replay[]>([]);
  const replayStr = searchParams.has("replays")
    ? atob(searchParams.get("replays") as string)
    : '[]';

  useEffect(() => {
    const parsed = JSON.parse(replayStr);
    setReplays(parsed.map((r: { timestamp: string; }) => ({
      ...r,
      timestamp: Date.parse(r.timestamp).valueOf(),
    })));
  }, [replayStr]);
  
  return (
    <ReplayContainer>
      {replays.map((r) => <ReplayView key={r.id} {...r} />)}
    </ReplayContainer>
  );
};

const ReplayContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 50px;
  align-items: center;
  background-color: rgb(200,200,200);
  width: 100%;
`;
