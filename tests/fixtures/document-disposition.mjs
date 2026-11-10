export function dispositionFixture(job,classification='research',supportStatus='supported'){
 const doc=job.document,p=doc.paragraphs[0];
 return {version:job.documentDispositionVersion,classification,proposedClassification:classification,reason:'原文范围需要结合企业已确认资料核验。',paragraphIndices:[p.index],gaps:[],supportStatus,support:supportStatus==='supported'?[{id:doc.id+':paragraph:'+p.index,kind:'paragraph',exact:p.text,documentVersion:doc.version}]:[],counterevidence:[],documentId:doc.id,documentVersion:doc.version,sourceId:doc.sourceId,sourceVersion:String(doc.sourceVersion),configurationVersion:job.configuration.version,configurationReferences:[],coverage:{processedParagraphIndices:doc.paragraphs.map(p=>p.index),paragraphCount:doc.paragraphs.length,scope:'provided_section_only'}};
}
