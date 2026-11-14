"""Drives the server in --source sim mode like a human would, to check the whole loop."""
import argparse, asyncio, json, websockets

async def main(n, host="localhost", port=8000):
    url = f"ws://{host}:{port}/ws"
    print(f"Connecting to {url}...")
    async with websockets.connect(url, max_size=None) as ws:
        state = json.loads(await ws.recv())
        print("Connected! Labels:", state["labels"], "existing samples:", state["n"])
        done = 0
        async def listener():
            nonlocal done
            try:
                async for raw in ws:
                    m = json.loads(raw)
                    if m["type"] == "sample":
                        done += 1
                        pred_str = m.get("pred") or "none"
                        conf_str = f"{round(m['conf'] * 100)}%" if m.get("conf") is not None else "--"
                        target_str = m.get("target") or m.get("sim_label") or "?"
                        print(f'#{done} target={target_str} pred={pred_str} conf={conf_str}')
                    elif m["type"] == "state" and m.get("training") is True:
                        print("Model training in progress...")
                    elif m["type"] == "state" and m.get("training") is False and m.get("loss") is not None and done and done % 10 == 0:
                        print(f"Training complete. Loss: {m.get('loss'):.4f}, trained on: {m.get('trained_on')}")
                    elif m["type"] == "notice":
                        print("Notice:", m["msg"])
            except asyncio.CancelledError:
                pass

        task = asyncio.create_task(listener())
        for _ in range(n):
            await ws.send(json.dumps({"cmd": "toggle"}))
            await asyncio.sleep(1.2)
            await ws.send(json.dumps({"cmd": "toggle"}))
            await asyncio.sleep(0.5)
        await asyncio.sleep(1.5)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("n", type=int, nargs="?", default=30, help="Number of simulated samples")
    parser.add_argument("--host", default="localhost", help="Server host")
    parser.add_argument("--port", type=int, default=8000, help="Server port")
    args = parser.parse_args()
    asyncio.run(main(args.n, args.host, args.port))
