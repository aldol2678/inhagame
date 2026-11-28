bl_info={"name":"INHA WORLD NPC Generator", "author":"ION", "version":(0,2,0), "blender":(4,3,0),
         "location":"3D View > Sidebar > INHA NPC", "description":"Customize reusable campus NPCs and export GLB", "category":"3D View"}
import bpy
from pathlib import Path
from . import core
FACE=[('original','Original',''),('round','Round',''),('narrow','Narrow',''),('angular','Angular','')]
HAIR=[('original','Template Style',''),('botany','Silver Curls',''),('literature','Wavy Bob',''),('architecture','Short Crop','')]
GLASSES=[('none','None',''),('round','Round Wire',''),('rect','Soft Rectangle','')]
BEARD=[('original','Template Default',''),('none','Clean Shaven',''),('stubble','Soft Stubble',''),('short','Short Beard','')]
class INHA_NPC_Options(bpy.types.PropertyGroup):
 face:bpy.props.EnumProperty(name='Face',items=FACE,default='original')
 hair:bpy.props.EnumProperty(name='Hair',items=HAIR,default='original')
 beard:bpy.props.EnumProperty(name='Beard',items=BEARD,default='original')
 glasses:bpy.props.EnumProperty(name='Glasses',items=GLASSES,default='round')
 height_cm:bpy.props.FloatProperty(name='Height (cm)',default=172.,min=140.,max=200.,precision=1)
 templates:bpy.props.StringProperty(name='Template Folder',subtype='DIR_PATH',default='//')
 filepath:bpy.props.StringProperty(name='GLB File',subtype='FILE_PATH',default='//INHA_NPC_Custom.glb')
 status:bpy.props.StringProperty(name='Result',default='')
def generate(ctx, do_export):
 c=ctx.scene.inha_npc_options
 out=Path(bpy.path.abspath(c.filepath))
 if do_export:
  if out.suffix.lower()!='.glb':raise ValueError('Choose a .glb file.')
  if out.exists():raise ValueError('That GLB already exists. Use a new filename.')
 q=core.update(dict(face=c.face,hair=c.hair,beard=c.beard,glasses=c.glasses,height_m=c.height_cm/100.,templates=bpy.path.abspath(c.templates)))
 if do_export:core.export(out)
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
class INHA_NPC_PT_Generator(bpy.types.Panel):
 bl_label='INHA WORLD NPC Generator';bl_idname='INHA_NPC_PT_generator';bl_space_type='VIEW_3D';bl_region_type='UI';bl_category='INHA NPC'
 def draw(self,context):
  p=self.layout; c=context.scene.inha_npc_options
  if not core.rig():p.label(text='Open a supplied .blend template',icon='INFO');return
  p.prop(c,'face');p.prop(c,'hair');p.prop(c,'beard');p.prop(c,'glasses');p.prop(c,'height_cm');p.operator('inha_npc.preview',icon='HIDE_OFF')
  p.separator();p.prop(c,'filepath');p.operator('inha_npc.export',icon='EXPORT')
  if c.status:p.label(text=c.status)
classes=(INHA_NPC_Options,INHA_NPC_OT_Preview,INHA_NPC_OT_Export,INHA_NPC_PT_Generator)
def register():
 for c in classes:bpy.utils.register_class(c)
 bpy.types.Scene.inha_npc_options=bpy.props.PointerProperty(type=INHA_NPC_Options)
def unregister():
 del bpy.types.Scene.inha_npc_options
 for c in reversed(classes):bpy.utils.unregister_class(c)
