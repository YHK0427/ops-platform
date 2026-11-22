import { useEffect, useState } from "react";
import type { AxiosInstance } from "axios";

// 인증이 필요한 이미지는 <img src> 로 직접 못 건다 — blob 으로 받아 object URL 로 띄운다.
// (운영 CSP img-src 에 blob: 이 있어야 보인다 — frontend/security-headers.conf)
export function useBlobUrl(client: AxiosInstance, path: string) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let revoked = false;
        let objectUrl: string | null = null;
        client.get(path, { responseType: "blob" })
            .then(({ data }) => {
                if (revoked) return;
                objectUrl = URL.createObjectURL(data);
                setUrl(objectUrl);
            })
            .catch(() => {});
        return () => {
            revoked = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [client, path]);
    return url;
}
