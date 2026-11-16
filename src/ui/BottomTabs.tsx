import { useState } from "react";
import { useStore } from "../store";
import type { Position } from "../engine/types";
import { ContextMenu } from "./ContextMenu";
import { ModifyDialog } from "./ModifyDialog";
import { computeStats } from "../engine/stats";
import { floatingUsd, markPrice } from "../engine/account";
import { getSymbolSpec } from "../engine/symbols";
import { fmtLots, fmtMoney, fmtPct, fmtPrice, fmtSigned, fmtTime } from "../lib/format";

type TabKey = "positions" | "orders" | "history" | "stats" | "journal";

export function BottomTabs() {
  const sim = useStore((s) => s.sim);
  const loaded = useStore((s) => s.loaded);
  const version = useStore((s) => s.version);
  const closeTicket = useStore((s) => s.closeTicket);
  const closeAll = useStore((s) => s.closeAll);
  const cancelPending = useStore((s) => s.cancelPending);

  const [tab, setTab] = useState<TabKey>("positions");
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "position" | "pending"; ticket: number } | null>(null);
  const [modify, setModify] = useState<{ kind: "position" | "pending"; ticket: number } | null>(null);
  void version;

  const spec = loaded ? getSymbolSpec(loaded.symbol) : null;
  const bar = sim?.currentBar() ?? null;
  const floatOf = (p: Position) =>
    bar && spec && sim ? floatingUsd(p, spec, bar.bid.c, bar.ask.c, sim.book) + p.swap : 0;

  const positions = sim?.positions ?? [];
  const pendings = sim?.pendings ?? [];
  const closed = sim?.closed ?? [];
  const stats = sim && loaded ? computeStats(sim.config.initialBalance, closed, sim.equityCurve) : null;
  const events = sim?.events ?? [];

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "positions", label: "Positions", count: positions.length },
    { key: "orders", label: "Open orders", count: pendings.length },
    { key: "history", label: "Trade history", count: closed.length },
    { key: "stats", label: "Statistics" },
    { key: "journal", label: "Journal", count: events.length },
  ];

  return (
    <section className="bottombar">
      <div className="tabbar">
        {tabs.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.count != null ? <span className="tab-count">{t.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="tab-body">
        {tab === "positions" ? (
          positions.length === 0 ? (
            <Empty text="No open positions. Buy or sell from the order panel (start the replay first)." />
          ) : (
            <div className="table-scroll">
              <div className="table-actions">
                <button className="secondary-btn small" onClick={closeAll}>
                  Close all
                </button>
                <span className="hint">right-click a row to modify SL/TP or close</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <Th>Ticket</Th>
                    <Th>Symbol</Th>
                    <Th>Side</Th>
                    <Th right>Lots</Th>
                    <Th right>Open</Th>
                    <Th right>Current</Th>
                    <Th right>SL</Th>
                    <Th right>TP</Th>
                    <Th right>Swap</Th>
                    <Th right>P/L</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const pl = floatOf(p);
                    return (
                      <tr
                        key={p.ticket}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenu({ x: e.clientX, y: e.clientY, kind: "position", ticket: p.ticket });
                        }}
                      >
                        <Td>{p.ticket}</Td>
                        <Td>{p.symbol}</Td>
                        <Td>
                          <span className={`side-chip ${p.side}`}>{p.side.toUpperCase()}</span>
                        </Td>
                        <Td right>{fmtLots(p.lots)}</Td>
                        <Td right>{spec ? fmtPrice(p.openPrice, spec.digits) : p.openPrice}</Td>
                        <Td right>{bar && spec ? fmtPrice(markPrice(p.side, bar.bid.c, bar.ask.c), spec.digits) : "—"}</Td>
                        <Td right>{p.sl != null && spec ? fmtPrice(p.sl, spec.digits) : "—"}</Td>
                        <Td right>{p.tp != null && spec ? fmtPrice(p.tp, spec.digits) : "—"}</Td>
                        <Td right>{fmtMoney(p.swap)}</Td>
                        <Td right className={pl < 0 ? "neg" : "pos"}>
                          {fmtMoney(pl)}
                        </Td>
                        <Td>
                          <button className="link-btn" onClick={() => closeTicket(p.ticket)}>
                            Close
                          </button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "orders" ? (
          pendings.length === 0 ? (
            <Empty text="No pending orders. Place buy/sell limits or stops from the order panel." />
          ) : (
            <div className="table-scroll">
              <div className="table-actions">
                <span className="hint">right-click a row to modify or cancel</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <Th>Ticket</Th>
                    <Th>Type</Th>
                    <Th right>Lots</Th>
                    <Th right>Price</Th>
                    <Th right>SL</Th>
                    <Th right>TP</Th>
                    <Th>OCO</Th>
                    <Th right>Created</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {pendings.map((o) => (
                    <tr
                      key={o.ticket}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, kind: "pending", ticket: o.ticket });
                      }}
                    >
                      <Td>{o.ticket}</Td>
                      <Td>{o.type.replace("_", " ")}</Td>
                      <Td right>{fmtLots(o.lots)}</Td>
                      <Td right>{spec ? fmtPrice(o.price, spec.digits) : o.price}</Td>
                      <Td right>{o.sl != null && spec ? fmtPrice(o.sl, spec.digits) : "—"}</Td>
                      <Td right>{o.tp != null && spec ? fmtPrice(o.tp, spec.digits) : "—"}</Td>
                      <Td>{o.ocoGroup != null ? `#${o.ocoGroup}` : "—"}</Td>
                      <Td right>{fmtTime(o.createdAt)}</Td>
                      <Td>
                        <button className="link-btn" onClick={() => cancelPending(o.ticket)}>
                          Cancel
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "history" ? (
          closed.length === 0 ? (
            <Empty text="No closed trades yet." />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <Th>Ticket</Th>
                    <Th>Side</Th>
                    <Th right>Lots</Th>
                    <Th right>Open</Th>
                    <Th right>Close</Th>
                    <Th right>Opened</Th>
                    <Th right>Closed</Th>
                    <Th right>Swap</Th>
                    <Th right>P/L</Th>
                    <Th>Reason</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...closed].reverse().map((t) => (
                    <tr key={`${t.ticket}-${t.closeTime}`}>
                      <Td>{t.ticket}</Td>
                      <Td>
                        <span className={`side-chip ${t.side}`}>{t.side.toUpperCase()}</span>
                      </Td>
                      <Td right>{fmtLots(t.lots)}</Td>
                      <Td right>{spec ? fmtPrice(t.openPrice, spec.digits) : t.openPrice}</Td>
                      <Td right>{spec ? fmtPrice(t.closePrice, spec.digits) : t.closePrice}</Td>
                      <Td right>{fmtTime(t.openTime)}</Td>
                      <Td right>{fmtTime(t.closeTime)}</Td>
                      <Td right>{fmtMoney(t.swap)}</Td>
                      <Td right className={t.pnl < 0 ? "neg" : "pos"}>
                        {fmtMoney(t.pnl)}
                      </Td>
                      <Td>
                        <span className={`reason-chip ${t.reason}`}>{t.reason}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "stats" && stats ? (
          <div className="stats-wrap">
            <div className="stats-grid">
              <Metric label="Net profit" value={fmtMoney(stats.netProfit)} accent={stats.netProfit >= 0 ? "pos" : "neg"} />
              <Metric label="Return" value={fmtPct(stats.returnPct)} accent={stats.returnPct >= 0 ? "pos" : "neg"} />
              <Metric label="Profit factor" value={stats.profitFactor === Number.POSITIVE_INFINITY ? "∞" : stats.profitFactor.toFixed(2)} />
              <Metric label="Win rate" value={fmtPct(stats.winRate)} />
              <Metric label="Trades" value={`${stats.totalTrades} (${stats.wins} W / ${stats.losses} L)`} />
              <Metric label="Expectancy" value={fmtMoney(stats.expectancy)} />
              <Metric label="Avg win" value={fmtMoney(stats.avgWin)} accent="pos" />
              <Metric label="Avg loss" value={fmtMoney(-stats.avgLoss)} accent="neg" />
              <Metric label="Max drawdown" value={fmtMoney(-stats.maxDrawdownAbs)} accent="neg" />
              <Metric label="Max drawdown %" value={fmtPct(stats.maxDrawdownPct)} accent="neg" />
              <Metric label="Longest win streak" value={String(stats.maxConsecutiveWins)} />
              <Metric label="Longest loss streak" value={String(stats.maxConsecutiveLosses)} />
              <Metric label="Commission" value={fmtMoney(stats.totalCommission)} />
              <Metric label="Swap" value={fmtMoney(stats.totalSwap)} />
              <Metric label="Start" value={fmtTime(stats.startTs)} />
              <Metric label="End" value={fmtTime(stats.endTs)} />
            </div>
            {stats.monthly.length > 0 ? (
              <div className="monthly">
                <table>
                  <thead>
                    <tr>
                      <Th>Month</Th>
                      <Th right>Net P/L</Th>
                      <Th right>Trades</Th>
                      <Th right>Wins</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.monthly.map((m) => (
                      <tr key={m.month}>
                        <Td>{m.month}</Td>
                        <Td right className={m.netPnl < 0 ? "neg" : "pos"}>
                          {fmtSigned(m.netPnl)}
                        </Td>
                        <Td right>{m.trades}</Td>
                        <Td right>{m.wins}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "journal" ? (
          events.length === 0 ? (
            <Empty text="The journal is empty — events appear as the replay trades." />
          ) : (
            <div className="table-scroll">
              <div className="journal-list">
                {[...events].reverse().slice(0, 400).map((e, i) => (
                  <div key={`${e.ts}-${i}`} className="journal-row">
                    <span className="journal-time">{fmtTime(e.ts)}</span>
                    <span className={`journal-kind ${e.kind}`}>{e.kind}</span>
                    <span className="journal-msg">{e.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : null}
      </div>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            menu.kind === "position"
              ? [
                  { label: "Modify SL / TP…", onClick: () => setModify({ kind: "position", ticket: menu.ticket }) },
                  { label: "Close position", danger: true, onClick: () => closeTicket(menu.ticket) },
                ]
              : [
                  { label: "Modify order…", onClick: () => setModify({ kind: "pending", ticket: menu.ticket }) },
                  { label: "Cancel order", danger: true, onClick: () => cancelPending(menu.ticket) },
                ]
          }
          onClose={() => setMenu(null)}
        />
      ) : null}

      {modify ? (
        <ModifyDialog
          key={`${modify.kind}-${modify.ticket}`}
          kind={modify.kind}
          ticket={modify.ticket}
          onClose={() => setModify(null)}
        />
      ) : null}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={right ? "right" : ""}>{children}</th>;
}

function Td({ children, right, className }: { children?: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`${right ? "right" : ""} ${className ?? ""}`}>{children}</td>;
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: "pos" | "neg" }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className={`metric-value ${accent ?? ""}`}>{value}</span>
    </div>
  );
}
