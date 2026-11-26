require('dotenv').config();
const db=require('../config/db');
const {balance,movement,audit}=require('../services/ledger');

async function main(){
 const c=await db.getConnection();
 try{
  await c.beginTransaction();
  const [[product]]=await c.execute("SELECT * FROM products WHERE sku='MUR-200' FOR UPDATE");
  const [[salesA]]=await c.execute("SELECT id FROM users WHERE email='salesman@smartfactory.local'");
  const [[salesB]]=await c.execute("SELECT id FROM users WHERE email='salesmanb@smartfactory.local'");
  const [[admin]]=await c.execute("SELECT id FROM users WHERE email='admin@smartfactory.local'");
  const [[retailer]]=await c.execute("SELECT id,state_code FROM customers WHERE name='Retailer A'");
  const [[distributor]]=await c.execute("SELECT id,state_code FROM customers WHERE name='Distributor B'");
  if(!product||!salesA||!salesB||!admin||!retailer||!distributor)throw Error('Run npm run seed first.');
  const [bom]=await c.execute(`SELECT bi.*,i.name,i.sku,i.item_type FROM boms b JOIN bom_items bi ON bi.bom_id=b.id JOIN inventory_items i ON i.id=bi.item_id WHERE b.product_id=? AND b.is_active=1`,[product.id]);
  const actualBySku={'RAW-FLOUR':40,'RAW-OIL':10.5,'RAW-SPICE':1.2,'PKG-POUCH':194,'PKG-CARTON':9};
  const [run]=await c.execute('INSERT INTO production_runs(product_id,batch_count,expected_output,actual_output,actual_wastage,damaged_pouches,labour_cost,utility_cost,status,created_by) VALUES(?,1,200,188,12,6,1200,600,\'DRAFT\',?)',[product.id,admin.id]);
  let material=0;
  for(const line of bom){
   const actual=actualBySku[line.sku],planned=Number(line.quantity_per_batch);
   if(await balance(c,line.item_type,line.item_id)<actual)throw Error(`Insufficient stock: ${line.name}`);
   const [[cost]]=await c.execute("SELECT COALESCE(SUM(quantity*unit_cost),0) v,COALESCE(SUM(quantity),0) q FROM stock_ledger WHERE item_type=? AND item_id=? AND movement_type IN ('OPENING','RECEIPT')",[line.item_type,line.item_id]);
   const avg=Number(cost.q)?Number(cost.v)/Number(cost.q):0,lineCost=Math.round(actual*avg*100)/100;material+=lineCost;
   await c.execute('INSERT INTO production_consumption(run_id,item_id,planned_quantity,actual_quantity,unit,variance_percent,unit_cost,line_cost) VALUES(?,?,?,?,?,?,?,?)',[run.insertId,line.item_id,planned,actual,line.unit,((actual-planned)/planned)*100,avg,lineCost]);
   await movement(c,{type:line.item_type,id:line.item_id,kind:'ISSUE',qty:actual,unit:line.unit,cost:avg,source:'PRODUCTION_RUN',sourceId:run.insertId,notes:`Benchmark actual consumption; damaged pouches: 6`},admin.id);
  }
  material=Math.round(material*100)/100;const total=Math.round((material+1800)*100)/100,costPerPacket=total/188;
  await c.execute("UPDATE production_runs SET material_cost=?,total_cost=?,cost_per_packet=?,status='POSTED' WHERE id=?",[material,total,costPerPacket,run.insertId]);
  await movement(c,{type:'FINISHED',id:product.id,kind:'PRODUCTION_IN',qty:188,unit:'packet',cost:costPerPacket,source:'PRODUCTION_RUN',sourceId:run.insertId},admin.id);
  await audit(c,admin.id,'POST','PRODUCTION_RUN',run.insertId,{expected:200,actual:188,wastage:12,damagedPouches:6,material,total,costPerPacket},'benchmark');
  const [orderA]=await c.execute("INSERT INTO sales_orders(customer_id,salesman_id,status,total_amount) VALUES(?,?,'SUBMITTED',7500)",[retailer.id,salesA.id]);
  await c.execute('INSERT INTO sales_order_items(order_id,product_id,quantity,unit_price) VALUES(?,?,150,50)',[orderA.insertId,product.id]);
  if(await balance(c,'FINISHED',product.id)<150)throw Error('Retailer A order unexpectedly has insufficient stock');
  await c.execute("UPDATE sales_orders SET status='APPROVED',approved_by=?,approved_at=NOW() WHERE id=?",[admin.id,orderA.insertId]);
  const d=new Date(),fy=d.getMonth()>=3?`${d.getFullYear()}-${String(d.getFullYear()+1).slice(-2)}`:`${d.getFullYear()-1}-${String(d.getFullYear()).slice(-2)}`;
  await c.execute('INSERT INTO invoice_sequences(financial_year,last_number) VALUES(?,0) ON DUPLICATE KEY UPDATE last_number=last_number',[fy]);const [[sequence]]=await c.execute('SELECT last_number FROM invoice_sequences WHERE financial_year=? FOR UPDATE',[fy]);const nextInvoiceNumber=Number(sequence.last_number)+1;await c.execute('UPDATE invoice_sequences SET last_number=? WHERE financial_year=?',[nextInvoiceNumber,fy]);const invoiceNo=`SF/${fy}/${String(nextInvoiceNumber).padStart(4,'0')}`;
  const [invoice]=await c.execute("INSERT INTO invoices(order_id,invoice_number,financial_year,taxable_value,cgst,sgst,igst,total_amount,created_by) VALUES(?,?,?,7500,187.50,187.50,0,7875,?)",[orderA.insertId,invoiceNo,fy,admin.id]);
  await c.execute("UPDATE sales_orders SET status='INVOICED' WHERE id=?",[orderA.insertId]);
  const [dispatch]=await c.execute('INSERT INTO dispatches(order_id,dispatch_date,reference_no,created_by) VALUES(?,CURDATE(),?,?)',[orderA.insertId,'BENCHMARK-DISPATCH',admin.id]);
  await c.execute('INSERT INTO dispatch_items(dispatch_id,product_id,quantity) VALUES(?,?,150)',[dispatch.insertId,product.id]);
  await movement(c,{type:'FINISHED',id:product.id,kind:'SALE',qty:150,unit:'packet',source:'DISPATCH',sourceId:dispatch.insertId},admin.id);
  await c.execute("UPDATE sales_orders SET status='DISPATCHED' WHERE id=?",[orderA.insertId]);
  const [orderB]=await c.execute("INSERT INTO sales_orders(customer_id,salesman_id,status,total_amount) VALUES(?,?,'SUBMITTED',6000)",[distributor.id,salesB.id]);
  await c.execute('INSERT INTO sales_order_items(order_id,product_id,quantity,unit_price) VALUES(?,?,120,50)',[orderB.insertId,product.id]);
  const availableForDistributor=await balance(c,'FINISHED',product.id);const shortage=Math.max(0,120-availableForDistributor);if(shortage>0)await audit(c,salesB.id,'SHORTAGE_BLOCKED','SALES_ORDER',orderB.insertId,{requested:120,available:availableForDistributor,shortage},'benchmark');
  await c.execute('INSERT INTO payments(invoice_id,amount,payment_date,mode,reference_no,created_by) VALUES(?,4000,CURDATE(),\'UPI\',\'BENCHMARK-PAYMENT\',?)',[invoice.insertId,admin.id]);
  await audit(c,admin.id,'BENCHMARK','SCENARIO',run.insertId,{orderA:orderA.insertId,invoice:invoiceNo,orderB:orderB.insertId,shortage},'benchmark');
  const expectedBalances=[['RAW', 'RAW-FLOUR',120],['RAW','RAW-OIL',19.5],['RAW','RAW-SPICE',3.8],['PACKAGING','PKG-POUCH',306],['PACKAGING','PKG-CARTON',21]];
  for(const [type,sku,expected] of expectedBalances){const [[item]]=await c.execute('SELECT id FROM inventory_items WHERE sku=?',[sku]);const actual=await balance(c,type,item.id);if(Math.abs(actual-expected)>0.0001)throw Error(`Benchmark assertion failed for ${sku}: expected ${expected}, got ${actual}`)}
  const finished=await balance(c,'FINISHED',product.id);if(finished!==88)throw Error(`Benchmark assertion failed for finished goods: expected 88, got ${finished}`);
  const [[invoiceCheck]]=await c.execute('SELECT i.taxable_value,i.cgst,i.sgst,i.igst,i.total_amount,COALESCE(SUM(p.amount),0) paid FROM invoices i LEFT JOIN payments p ON p.invoice_id=i.id WHERE i.id=? GROUP BY i.id',[invoice.insertId]);
  if(Number(invoiceCheck.taxable_value)!==7500||Number(invoiceCheck.cgst)!==187.5||Number(invoiceCheck.sgst)!==187.5||Number(invoiceCheck.igst)!==0||Number(invoiceCheck.total_amount)!==7875||Number(invoiceCheck.paid)!==4000)throw Error('Benchmark assertion failed for GST invoice or payment totals');
  if(shortage!==32||Math.round(costPerPacket*100)/100!==31.14)throw Error('Benchmark assertion failed for distributor shortage or unit cost');
  await c.commit();
  const [[flour]]=await db.execute("SELECT id FROM inventory_items WHERE sku='RAW-FLOUR'");const [[oil]]=await db.execute("SELECT id FROM inventory_items WHERE sku='RAW-OIL'");const [[spice]]=await db.execute("SELECT id FROM inventory_items WHERE sku='RAW-SPICE'");const [[pouch]]=await db.execute("SELECT id FROM inventory_items WHERE sku='PKG-POUCH'");const [[carton]]=await db.execute("SELECT id FROM inventory_items WHERE sku='PKG-CARTON'");console.log(JSON.stringify({productionRun:run.insertId,expectedOutput:200,actualOutput:188,yieldVariancePercent:-6,damagedPouches:6,closing:{flourKg:await balance(db,'RAW',flour.id),oilLitres:await balance(db,'RAW',oil.id),spiceKg:await balance(db,'RAW',spice.id),pouches:await balance(db,'PACKAGING',pouch.id),cartons:await balance(db,'PACKAGING',carton.id),finishedPackets:await balance(db,'FINISHED',product.id)},materialCost:material,overheads:1800,totalProductionCost:total,costPerPacket:Number(costPerPacket.toFixed(2)),retailerInvoice:invoiceNo,taxable:7500,cgst:187.5,sgst:187.5,totalInvoice:7875,paid:4000,outstanding:3875,distributorOrder:orderB.insertId,distributorAvailable:availableForDistributor,distributorShortage:shortage,distributorOrderStatus:'SUBMITTED (approval blocked by stock shortage)'},null,2));
 }catch(e){await c.rollback();throw e}finally{c.release();await db.end()}
}
main().catch(e=>{console.error(e);process.exit(1)});
