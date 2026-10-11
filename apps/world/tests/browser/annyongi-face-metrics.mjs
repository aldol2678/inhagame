// Pixel masks stay in the browser; only counts, component extents and verdicts leave it.
export function analyzeFaceMasks(visible, measured, dark, width, height) {
  if (visible.length !== width * height || measured.length !== visible.length || dark.length !== visible.length) throw Error('Invalid mask dimensions');
  const label = mask => {
    const labels = new Int32Array(mask.length), components = [];
    for (let start = 0; start < mask.length; start++) if (mask[start] && !labels[start]) {
      const id = components.length + 1, queue = [start]; labels[start] = id;
      let pixels = 0, minX = width, minY = height, maxX = -1, maxY = -1;
      while (queue.length) {
        const i = queue.pop(), x = i % width, y = Math.floor(i / width); pixels++;
        minX = Math.min(minX,x); minY = Math.min(minY,y); maxX = Math.max(maxX,x); maxY = Math.max(maxY,y);
        for (let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
          if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy,j=ny*width+nx;
          if(nx>=0&&nx<width&&ny>=0&&ny<height&&mask[j]&&!labels[j]){labels[j]=id;queue.push(j);}
        }
      }
      components.push({pixels,bounds:{minX,minY,maxX,maxY},span:Math.max(maxX-minX+1,maxY-minY+1),start});
    }
    return {labels,components};
  };
  const excluded=visible.map((v,i)=>v&&!measured[i]?1:0), missing=measured.map((v,i)=>v&&!dark[i]?1:0);
  const v=label(visible),m=label(measured),d=label(dark),e=label(excluded),g=label(missing);
  const fragments=new Map();
  for(const c of d.components)if(c.pixels>=3){const parent=m.labels[c.start];if(parent)fragments.set(parent,(fragments.get(parent)||0)+1);}
  const measurableFragments=new Map();
  for(const c of m.components)if(c.pixels>=3){const parent=v.labels[c.start];if(parent)measurableFragments.set(parent,(measurableFragments.get(parent)||0)+1);}
  const summarize=parts=>({count:parts.length,meaningfulCount:parts.filter(c=>c.pixels>=3).length,largest:Math.max(0,...parts.map(c=>c.pixels)),maxSpan:Math.max(0,...parts.map(c=>c.span)),regions:parts.sort((a,b)=>b.pixels-a.pixels).slice(0,8).map(({start,...rest})=>rest)});
  const count=a=>a.reduce((n,x)=>n+Number(Boolean(x)),0);
  const visiblePixels=count(visible), measuredPixels=count(measured), darkPixels=count(dark);
  return {visiblePixels,measuredPixels,darkPixels,measurement:!visiblePixels?'OCCLUDED_OR_SUBPIXEL':!measuredPixels?'UNMEASURABLE':measuredPixels<visiblePixels?'PARTIAL':'FULL',measuredFraction:visiblePixels?measuredPixels/visiblePixels:null,darkFraction:measuredPixels?darkPixels/measuredPixels:null,visible:summarize(v.components),measured:summarize(m.components),dark:summarize(d.components),excluded:summarize(e.components),missing:summarize(g.components),unresolvedVisibleComponents:[...measurableFragments.values()].filter(n=>n>1).length,brokenMeasuredComponents:[...fragments.values()].filter(n=>n>1).length};
}
export const FACE_LINE_NAMES=['Forelock curled contour','Nose lobe contour -1','Nose lobe contour 1','Open smile outer contour','Smile upper lip -1','Smile upper lip 1'];
export function faceContrastFailures(metrics) {
  const failures=[];
  for(const name of FACE_LINE_NAMES)if(!metrics['node:'+name])failures.push(`Missing required line: ${name}`);
  for(const [name,m] of Object.entries(metrics)) {
    if(!name.startsWith('node:'))continue;
    const fixed=m.contrast.fixed,old=m.contrast.white,c=fixed.connectivity;
    if(!Number.isFinite(fixed.darkFraction)||!Number.isFinite(fixed.medianInkToSkin)||!Number.isFinite(old.darkFraction)||!Number.isFinite(old.medianInkToSkin)||!(fixed.samples>0)||!(old.samples>0)){failures.push(`${name}: non-finite or empty contrast control`);continue;}
    if(!c.visiblePixels||!c.measuredPixels){failures.push(`${name}: unmeasurable`);continue;}
    if(c.measuredFraction<.8)failures.push(`${name}: insufficient measurable ROI`);
    if(fixed.darkFraction<.98||fixed.medianInkToSkin>.3)failures.push(`${name}: authored dark line contrast lost`);
    if(c.unresolvedVisibleComponents)failures.push(`${name}: excluded pixels interrupt visible line`);
    if(c.brokenMeasuredComponents)failures.push(`${name}: measured line fragmented`);
    if(c.missing.largest>4||c.missing.maxSpan>3)failures.push(`${name}: missing line cluster`);
    if(old.darkFraction>=.8)failures.push(`${name}: whitewash negative control did not reproduce loss`);
  }
  return failures;
}
