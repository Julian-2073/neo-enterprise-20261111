export const viewEvidenceId=(snapshotId:string,view:string,...args:string[])=>`${snapshotId}:view:${[view,...args].map(encodeURIComponent).join(':')}`;
