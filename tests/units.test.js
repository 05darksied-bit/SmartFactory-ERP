const {convert}=require('../backend/utils/units');
test('mass and volume conversion',()=>{expect(convert(1000,'g','kg')).toBe(1);expect(convert(2,'litre','ml')).toBe(2000)});
test('carton conversion uses 20 packets',()=>{expect(convert(3,'carton','packet')).toBe(60);expect(convert(40,'packet','carton')).toBe(2)});
test('reject incompatible units',()=>{expect(()=>convert(2,'kg','litre')).toThrow()});
