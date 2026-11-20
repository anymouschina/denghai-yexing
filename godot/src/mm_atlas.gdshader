shader_type canvas_item;
// MultiMesh 图集精灵着色器：INSTANCE_CUSTOM = (u0, v0, du, dv)；水平翻转传入 (u1, v0, -du, dv)
void vertex() {
	UV = INSTANCE_CUSTOM.xy + UV * INSTANCE_CUSTOM.zw;
}
