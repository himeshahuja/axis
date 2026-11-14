"""Drives the server in --source sim mode like a human would, to check the whole loop."""
import asyncio, json, sys, websockets

async def main(n):
    async with websockets.connect("ws://localhost:8000/ws", max_size=None) as ws:
        state = json.loads(await ws.recv())
        print("labels", state["labels"], "existing samples", state["n"])
        done = 0
        async def listener():
            nonlocal done
            async for raw in ws:
                m = json.loads(raw)
                if m["type"] == "sample":
                    done += 1
                    print(f'#{done} target={m["target"]} pred={m["pred"]} conf={m["conf"]}')
                elif m["type"] == "state" and m["training"] is False and m["loss"] is not None and done and done % 10 == 0:
                    pass
                elif m["type"] == "notice":
                    print("notice", m["msg"])
        task = asyncio.create_task(listener())
        for _ in range(n):
            await ws.send(json.dumps({"cmd": "toggle"}))
            await asyncio.sleep(1.5)
            await ws.send(json.dumps({"cmd": "toggle"}))
            await asyncio.sleep(0.6)
        await asyncio.sleep(2)
        task.cancel()

asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 30))
