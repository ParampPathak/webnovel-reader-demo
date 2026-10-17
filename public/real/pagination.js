/* Rendered CSS-column pages with stable DOM text offsets, never character-count pages. */
'use strict';
(function(root){
 const pageCount=(extent,width)=>Math.max(1,Math.ceil((extent-1)/Math.max(1,width)));
 const pageFor=(left,width,extent=null)=>{width=Math.max(1,width);if(Number.isFinite(extent)&&extent>width&&left>=extent-width-1)return pageCount(extent,width)-1;return Math.max(0,Math.floor((left+.5)/width));};
 function textNodes(doc){const out=[],walk=doc.createTreeWalker(doc.body,4);let node;while((node=walk.nextNode()))if(node.textContent)out.push(node);return out;}
 function anchor(doc){
  if(!doc?.body||!doc?.createTreeWalker)return '';
  const nodes=textNodes(doc),scroll=doc.scrollingElement;let offset=0;
  for(const node of nodes){const range=doc.createRange();range.selectNodeContents(node);const rects=range.getClientRects();
   if([...rects].some(r=>r.right>8&&r.left<doc.documentElement.clientWidth-8&&r.bottom>8&&r.top<doc.documentElement.clientHeight-8)){
    // Locate the first visible character even when one paragraph spans many pages.
    let lo=0,hi=node.length-1;const horizontal=scroll.scrollWidth>doc.documentElement.clientWidth+1;
    while(lo<hi){const mid=Math.floor((lo+hi)/2);range.setStart(node,mid);range.setEnd(node,mid+1);const r=range.getBoundingClientRect();if(horizontal?r.right<=8:r.bottom<=8)lo=mid+1;else hi=mid;}
    return 'text:'+String(offset+lo);
   }offset+=node.length;
  }return ''; // No visible text is a loading/layout condition, never an EOF locator.

 }
 function target(doc,locator){
  const match=/^text:(\d+)$/.exec(locator||'');if(!match||!doc?.body)return null;
  let offset=Number(match[1]);if(!Number.isSafeInteger(offset))return null;
  const nodes=textNodes(doc);let last;
  for(const node of nodes){
   if(offset<node.length){const range=doc.createRange();range.setStart(node,offset);range.setEnd(node,offset+1);return range;}
   offset-=node.length;
   const meaningful=node.textContent.search(/\S(?=\s*$)/);
   if(meaningful>=0)last={node,index:meaningful};
  }
  // Older capture code could persist exactly the total length (EOF). Resolve
  // that boundary to the final passage; reject beyond-end/wrong-document offsets.
  if(offset===0&&last){const range=doc.createRange();range.setStart(last.node,last.index);range.setEnd(last.node,last.index+1);return range;}
  return null;
 }
 function reveal(doc,element,pages){const r=element.getBoundingClientRect();const s=doc.scrollingElement;if(pages)s.scrollLeft=pageFor(r.left+s.scrollLeft,doc.documentElement.clientWidth)*doc.documentElement.clientWidth;else s.scrollTop+=r.top-24;}
 function restore(doc,fraction,locator,pages){const s=doc.scrollingElement;const found=target(doc,locator)||doc.getElementById(locator);if(found){reveal(doc,found,pages);return;}if(pages){const w=doc.documentElement.clientWidth;s.scrollLeft=Math.round(Math.max(0,Math.min(1,fraction))*(pageCount(s.scrollWidth,w)-1))*w;}else s.scrollTop=Math.max(0,s.scrollHeight-s.clientHeight)*fraction;}
 root.ReaderPagination={pageCount,pageFor,anchor,target,reveal,restore};if(typeof module!=='undefined')module.exports=root.ReaderPagination;
})(typeof window!=='undefined'?window:globalThis);
