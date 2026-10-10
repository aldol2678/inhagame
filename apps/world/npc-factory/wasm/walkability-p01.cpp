// WASM-P01: freestanding f64 batch walkability, no libc/WASI, I/O or allocation.
// Geometry is immutable and packed once by the JS owner. Codes 2/3 defer to JS.
using u32 = unsigned int;
using u8 = unsigned char;
static double absd(double x) { return x < 0 ? -x : x; }
static double mind(double a, double b) { return a < b ? a : b; }
static double maxd(double a, double b) { return a > b ? a : b; }
static bool finite(double x) { return __builtin_isfinite(x); }

// 0 outside, 1 overlaps, 3 numerically sensitive: use original JS predicate.
static int polygon(double x, double z, const double* record, const double* edges, double radius) {
  bool inside = false;
  const u32 start = (u32)record[4], count = (u32)record[5];
  const double epsilon = 1e-10 * (1 + absd(x) + absd(z));
  for (u32 i = 0; i < count; ++i) {
    const double* e = edges + (start + i) * 7;
    const double ax=e[0], az=e[1], bx=e[2], bz=e[3], tx=e[4], tz=e[5], length=e[6];
    if ((az > z) != (bz > z)) {
      const double crossing = (bx-ax)*(z-az)/(bz-az)+ax;
      if (absd(x-crossing) <= epsilon) return 3;
      if (x < crossing) inside = !inside;
    }
    if (length == 0) continue; // JS's NaN tangent makes the radius test false.
    const double u = maxd(0,mind(length,(x-ax)*tx+(z-az)*tz));
    const double dx=x-ax-u*tx, dz=z-az-u*tz;
    const double distance=__builtin_sqrt(dx*dx+dz*dz);
    if (absd(distance-radius) <= epsilon) return 3;
    if (distance < radius) return 1;
  }
  return inside ? 1 : 0;
}
static bool inBox(double x,double z,const double* r,double c) {
  return x>=r[0]-c && x<=r[1]+c && z>=r[2]-c && z<=r[3]+c;
}
extern "C" int abi_version() { return 1; }
extern "C" void classify(const double* config,const double* records,const double* edges,
    const u32* offsets,const u32* indices,const double* points,u32 count,u8* out) {
  const double clearance=config[4];
  const u32 columns=(u32)config[5];
  for(u32 i=0;i<count;++i) {
    const double x=points[i*2],z=points[i*2+1];
    out[i]=0;
    if(!finite(x)||!finite(z)||x<config[0]||x>config[1]||z<config[2]||z>config[3]) continue;
    if(inBox(x,z,records,clearance)) {
      const int hit=polygon(x,z,records,edges,clearance);
      if(hit==3){out[i]=3;continue;}
      if(hit==1)continue; // Pond can never use the corridor override.
    }
    const u32 cell=(u32)__builtin_floor((z-config[2])/8)*columns+(u32)__builtin_floor((x-config[0])/8);
    out[i]=1;
    for(u32 j=offsets[cell];j<offsets[cell+1];++j) {
      const double* record=records+indices[j]*6;
      if(!inBox(x,z,record,clearance))continue;
      const int hit=record[5]==0 ? 1 : polygon(x,z,record,edges,clearance);
      if(hit==3){out[i]=3;break;}
      if(hit==1){out[i]=2;break;} // Original JS owns the on-network exception.
    }
  }
}
