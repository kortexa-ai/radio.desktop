import { Electroview } from "electrobun/view";
import type { AppRPC } from "../shared/types";

const rpc = Electroview.defineRPC<AppRPC>({
    handlers: {
        requests: {},
        messages: {
            generationStatus: (msg) => {
                window.dispatchEvent(
                    new CustomEvent("generationStatus", { detail: msg }),
                );
            },
            playbackCommand: (msg) => {
                window.dispatchEvent(
                    new CustomEvent("playbackCommand", { detail: msg }),
                );
            },
        },
    },
});

export const electroview = new Electroview({ rpc });
export default electroview;
