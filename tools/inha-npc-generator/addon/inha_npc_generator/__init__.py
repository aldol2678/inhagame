bl_info={"name":"INHA WORLD NPC Generator", "author":"ION", "version":(0,4,0), "blender":(4,3,0),
         "location":"3D View > Sidebar > INHA NPC", "description":"Customize NPCs and export selectable activity rigs", "category":"3D View"}
import bpy
from pathlib import Path
from . import core
FACE=[('original','Original',''),('round','Round',''),('narrow','Narrow',''),('angular','Angular','')]
HAIR=[('original','Template Style',''),('botany','Silver Curls',''),('literature','Wavy Bob',''),('architecture','Short Crop','')]
GLASSES=[('none','None',''),('round','Round Wire',''),('rect','Soft Rectangle','')]
BEARD=[('original','Template Default',''),('none','Clean Shaven',''),('stubble','Soft Stubble',''),('short','Short Beard','')]
RIGS=[
 ('seat','벤치에 앉기','좌판에 맞출 수 있도록 접점 포함',1),
 ('photo','사진 찍기','카메라를 붙일 오른손 소켓 포함',2),
 ('read','책 들고 걷기 · 읽기','왼팔로 책을 끼고 걷고, 도착해서 두 손으로 읽기',4),
 ('coffee','커피 마시기','오른손 컵을 입에 가져갔다 내리기',8),
 ('phone','휴대폰 보기','화면을 얼굴 쪽으로 들어서 확인',16),
 ('snack','간식 먹기','오른손 샌드위치를 입에 가져갔다 내리기',32),
]
RIG_LABELS={r[0]:r[1] for r in RIGS}
def source_changed(self,context):
 self.existing_rigs=''
 self.status=''
class INHA_NPC_Options(bpy.types.PropertyGroup):
 face:bpy.props.EnumProperty(name='Face',items=FACE,default='original')
 hair:bpy.props.EnumProperty(name='Hair',items=HAIR,default='original')
 beard:bpy.props.EnumProperty(name='Beard',items=BEARD,default='original')
 glasses:bpy.props.EnumProperty(name='Glasses',items=GLASSES,default='round')
 height_cm:bpy.props.FloatProperty(name='Height (cm)',default=172.,min=140.,max=200.,precision=1)
 templates:bpy.props.StringProperty(name='Template Folder',subtype='DIR_PATH',default='//')
 activities:bpy.props.EnumProperty(name='활동 리깅',items=RIGS,options={'ENUM_FLAG'},default=set())
 filepath:bpy.props.StringProperty(name='GLB File',subtype='FILE_PATH',default='//INHA_NPC_Custom.glb')
 source_glb:bpy.props.StringProperty(name='기존 NPC GLB',subtype='FILE_PATH',update=source_changed)
 patched_glb:bpy.props.StringProperty(name='새 GLB 저장 경로',subtype='FILE_PATH',default='//INHA_NPC_Rigged.glb')
 existing_rigs:bpy.props.StringProperty(default='')
 status:bpy.props.StringProperty(name='Result',default='')
def generate(ctx, do_export):
 c=ctx.scene.inha_npc_options
 out=Path(bpy.path.abspath(c.filepath))
 if do_export:
  if out.suffix.lower()!='.glb':raise ValueError('Choose a .glb file.')
  if out.exists():raise ValueError('That GLB already exists. Use a new filename.')
 q=core.update(dict(face=c.face,hair=c.hair,beard=c.beard,glasses=c.glasses,height_m=c.height_cm/100.,templates=bpy.path.abspath(c.templates)))
 if do_export:core.export(out,c.activities)
 c.status=f"{q['measuredHeight_m']*100:.1f} cm | "+('GLB exported' if do_export else 'Preview updated')
class INHA_NPC_OT_Preview(bpy.types.Operator):
 bl_idname='inha_npc.preview';bl_label='Update Preview';bl_options={'REGISTER','UNDO'}
 def execute(self,context):
  try:generate(context,False)
  except Exception as e:self.report({'ERROR'},str(e));return {'CANCELLED'}
  return {'FINISHED'}
class INHA_NPC_OT_Export(bpy.types.Operator):
 bl_idname='inha_npc.export';bl_label='Generate and Export GLB';bl_options={'REGISTER'}
 def execute(self,context):
  try:generate(context,True)
  except Exception as e:self.report({'ERROR'},str(e));return {'CANCELLED'}
  return {'FINISHED'}
class INHA_NPC_OT_InspectGLB(bpy.types.Operator):
 bl_idname='inha_npc.inspect_glb';bl_label='GLB 동작 확인'
 def execute(self,context):
  from .patch_existing import inspect
  c=context.scene.inha_npc_options
  try:kinds=inspect(Path(bpy.path.abspath(c.source_glb)))
  except Exception as e:self.report({'ERROR'},str(e));return {'CANCELLED'}
  c.existing_rigs=','.join(kinds) or 'none'
  c.status=''
  return {'FINISHED'}
class INHA_NPC_OT_PatchGLB(bpy.types.Operator):
 bl_idname='inha_npc.patch_glb';bl_label='동작 추가 후 새 GLB 저장'
 def execute(self,context):
  from .patch_existing import add_to_copy
  c=context.scene.inha_npc_options
  try:r=add_to_copy(Path(bpy.path.abspath(c.source_glb)),Path(bpy.path.abspath(c.patched_glb)),c.activities)
  except Exception as e:self.report({'ERROR'},str(e));return {'CANCELLED'}
  c.existing_rigs=','.join(r['kept']) or 'none'
  c.status=f"새 GLB 저장 · 동작 {len(r['added'])}종 추가" if r['added'] else '이미 있는 동작이에요. 새 파일은 만들지 않았어요.'
  self.report({'INFO'},c.status)
  return {'FINISHED'}
class INHA_NPC_PT_Generator(bpy.types.Panel):
 bl_label='INHA WORLD NPC Generator';bl_idname='INHA_NPC_PT_generator';bl_space_type='VIEW_3D';bl_region_type='UI';bl_category='INHA NPC'
 def draw(self,context):
  p=self.layout; c=context.scene.inha_npc_options
  if core.rig():
   box=p.box();box.label(text='새 NPC 내보내기')
   box.prop(c,'face');box.prop(c,'hair');box.prop(c,'beard');box.prop(c,'glasses');box.prop(c,'height_cm')
   box.prop(c,'templates');box.operator('inha_npc.preview',icon='HIDE_OFF')
   box.prop(c,'filepath');box.operator('inha_npc.export',icon='EXPORT')
  else:p.label(text='새 NPC를 만들려면 템플릿을 열어 주세요.',icon='INFO')
  p.prop(c,'activities',expand=True)
  box=p.box();box.label(text='기존 GLB에 동작 추가')
  box.prop(c,'source_glb')
  row=box.row();row.enabled=bool(c.source_glb);row.operator('inha_npc.inspect_glb')
  if c.existing_rigs=='none':box.label(text='들어 있는 추가 동작 없음')
  elif c.existing_rigs:
   for kind in c.existing_rigs.split(','):box.label(text=RIG_LABELS[kind],icon='CHECKMARK')
  box.prop(c,'patched_glb')
  row=box.row();row.enabled=bool(c.source_glb and c.activities);row.operator('inha_npc.patch_glb',icon='EXPORT')
  if c.status:p.label(text=c.status)
classes=(INHA_NPC_Options,INHA_NPC_OT_Preview,INHA_NPC_OT_Export,INHA_NPC_OT_InspectGLB,INHA_NPC_OT_PatchGLB,INHA_NPC_PT_Generator)
def register():
 for c in classes:bpy.utils.register_class(c)
 bpy.types.Scene.inha_npc_options=bpy.props.PointerProperty(type=INHA_NPC_Options)
def unregister():
 del bpy.types.Scene.inha_npc_options
 for c in reversed(classes):bpy.utils.unregister_class(c)
