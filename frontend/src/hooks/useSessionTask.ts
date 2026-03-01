import { useState } from "react";
import { useCrawlerTask } from "./useCrawler";
import { getTaskId, setTaskId as setTaskIdStore } from "@/stores/taskStore";

/**
 * Wraps useCrawlerTask with persistent task ID storage.
 * Task IDs survive tab navigation within the SPA.
 */
export function useSessionTask(sessionId: number, taskType: string) {
    const [taskId, _setTaskId] = useState<string | null>(
        () => getTaskId(sessionId, taskType)
    );

    const setTaskId = (id: string) => {
        setTaskIdStore(sessionId, taskType, id);
        _setTaskId(id);
    };

    const { data: taskStatus } = useCrawlerTask(taskId);

    return { taskId, setTaskId, taskStatus };
}
